import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { UpdateCommand, UpdateStatus } from "../shared/update-protocol.js";
import {
  parseVersion,
  type Release,
  readChecksum,
  releasesSchema,
  repository,
  selectRelease,
  type UpdateCandidate,
} from "./update-release.js";

const maxFile = 2 * 1024 ** 3;
const preferencesSchema = z.object({
  channel: z.enum(["stable", "preview"]),
  startup: z.boolean(),
});
export function validateUpdateUrl(
  value: string,
  asset: boolean,
  redirect = false,
): URL {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.hash
  )
    throw new Error("Unsafe update URL");
  const api =
    url.hostname === "api.github.com" &&
    url.pathname === `/repos/${repository}/releases`;
  const source =
    url.hostname === "github.com" &&
    url.pathname.startsWith(`/${repository}/releases/download/desktop-`) &&
    !url.search;
  const cdn =
    redirect &&
    [
      "release-assets.githubusercontent.com",
      "objects.githubusercontent.com",
    ].includes(url.hostname);
  if (!(asset ? source || cdn : api))
    throw new Error("Untrusted update host or path");
  return url;
}
export class UpdateService {
  status: UpdateStatus;
  private candidate: UpdateCandidate | undefined;
  private checksum: string | undefined;
  private controller: AbortController | undefined;
  private active: Promise<UpdateStatus> | undefined;
  private directory: string | undefined;
  private verified: { path: string; digest: string } | undefined;
  constructor(
    private readonly options: {
      root: string;
      version: string | null;
      arch: string;
      startupAllowed: boolean;
      fetch: typeof fetch;
      openPath: (path: string) => Promise<string>;
    },
  ) {
    this.status = {
      version: options.version,
      channel:
        options.version && parseVersion(options.version).pre.length
          ? "preview"
          : "stable",
      startup: options.startupAllowed,
      phase: "unchecked",
    };
  }
  async initialize(): Promise<void> {
    await mkdir(this.options.root, { recursive: true, mode: 0o700 });
    const stat = await lstat(this.options.root);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error("Unsafe update directory");
    this.options.root = await realpath(this.options.root);
    for (const name of (await readdir(this.options.root)).slice(0, 1000)) {
      if (!/^session-[A-Za-z0-9]{6}$/.test(name)) continue;
      const path = join(this.options.root, name);
      const entry = await lstat(path);
      if (
        entry.isDirectory() &&
        !entry.isSymbolicLink() &&
        Date.now() - entry.mtimeMs > 86400000
      )
        await rm(path, { recursive: true, force: true });
    }
    try {
      const preferences = preferencesSchema.parse(
        JSON.parse(
          await readFile(join(this.options.root, "preferences.json"), "utf8"),
        ),
      );
      Object.assign(this.status, preferences);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        this.status = {
          ...this.status,
          phase: "failed",
          error: "Cannot read update preferences",
          retry: "check",
          startup: false,
        };
    }
    // Session directories are disposable. Never reuse an installer without a new download and hash.
    this.directory = await mkdtemp(join(this.options.root, "session-"));
  }
  start(): void {
    if (this.options.startupAllowed && this.status.startup)
      void this.command({ type: "check" });
  }
  async command(command: UpdateCommand): Promise<UpdateStatus> {
    if (command.type === "status") return { ...this.status };
    if (command.type === "cancel") {
      this.controller?.abort();
      return { ...this.status };
    }
    if (this.active) return this.active;
    this.controller = new AbortController();
    const signal = this.controller.signal;
    this.active = this.perform(command, signal)
      .catch((error: unknown) => {
        if (signal.aborted)
          this.status = {
            ...this.status,
            phase: this.candidate ? "available" : "unchecked",
            error: undefined,
            received: undefined,
            total: undefined,
          };
        else
          this.status = {
            ...this.status,
            phase: "failed",
            error: error instanceof Error ? error.message : "Update failed",
            retry:
              command.type === "download" || command.type === "open"
                ? "download"
                : "check",
          };
        return { ...this.status };
      })
      .finally(() => {
        this.active = undefined;
        this.controller = undefined;
      });
    return this.active;
  }
  private async request(
    url: string,
    asset: boolean,
    signal: AbortSignal,
  ): Promise<Response> {
    let next = url;
    for (let redirect = 0; redirect <= 4; redirect++) {
      signal.throwIfAborted();
      validateUpdateUrl(next, asset, redirect > 0);
      const response = await this.options.fetch(next, {
        redirect: "manual",
        credentials: "omit",
        cache: "no-store",
        signal,
        headers: {
          Accept: asset
            ? "application/octet-stream"
            : "application/vnd.github+json",
        },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location) throw new Error("Missing redirect location");
        next = new URL(location, next).href;
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(
          `GitHub HTTP ${response.status}${response.status === 403 || response.status === 429 ? " (rate limit or access denied; retry later)" : ""}`,
        );
      }
      return response;
    }
    throw new Error("Too many update redirects");
  }
  private async consume(
    response: Response,
    limit: number,
    signal: AbortSignal,
    write?: (chunk: Uint8Array) => Promise<void>,
  ): Promise<string> {
    const declared = Number(response.headers.get("content-length"));
    if (declared > limit) {
      await response.body?.cancel();
      throw new Error("Update response too large");
    }
    if (!response.body) throw new Error("Empty update response");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    try {
      while (true) {
        signal.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > limit) throw new Error("Update response too large");
        if (write) {
          await write(value);
          this.status = {
            ...this.status,
            received,
            total: declared > 0 ? declared : undefined,
          };
        } else chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    return write ? "" : Buffer.concat(chunks).toString("utf8");
  }
  private async perform(
    command: Exclude<UpdateCommand, { type: "status" | "cancel" }>,
    signal: AbortSignal,
  ): Promise<UpdateStatus> {
    if (
      !this.directory ||
      (await realpath(this.directory)) !== this.directory ||
      (await realpath(this.options.root)) !== this.options.root
    )
      throw new Error("Unsafe update cache");
    if (command.type === "preferences") {
      const path = join(this.options.root, "preferences.json");
      if (!this.directory) throw new Error("Update cache unavailable");
      const temporary = join(this.directory, "preferences.tmp");
      await rm(temporary, { force: true });
      await writeFile(
        temporary,
        JSON.stringify({ channel: command.channel, startup: command.startup }),
        { mode: 0o600, flag: "wx" },
      );
      await rename(temporary, path);
      const changed = this.status.channel !== command.channel;
      this.status = {
        ...this.status,
        channel: command.channel,
        startup: command.startup,
      };
      if (!changed) return { ...this.status };
    }
    if (command.type === "check" || command.type === "preferences") {
      for (const name of await readdir(this.directory)) {
        if (/^forge-desktop-[0-9.]+-(arm64|x64)\.dmg$/.test(name))
          await rm(join(this.directory, name), { force: true });
      }
      this.candidate = undefined;
      this.checksum = undefined;
      this.verified = undefined;
      this.status = {
        ...this.status,
        phase: "checking",
        error: undefined,
        target: undefined,
        notes: undefined,
        retry: undefined,
        received: undefined,
        total: undefined,
      };
      if (!this.status.version)
        throw new Error(
          "Desktop build identity is missing; install an identified build manually",
        );
      const bounded = AbortSignal.any([signal, AbortSignal.timeout(30000)]);
      const releases: Release[] = [];
      let complete = false;
      for (let page = 1; page <= 10; page++) {
        const response = await this.request(
          `https://api.github.com/repos/${repository}/releases?per_page=100&page=${page}`,
          false,
          bounded,
        );
        const items = releasesSchema.parse(
          JSON.parse(await this.consume(response, 4 * 1024 ** 2, bounded)),
        );
        releases.push(...items);
        if (items.length < 100) {
          complete = true;
          break;
        }
      }
      if (!complete)
        throw new Error(
          "Release enumeration incomplete; cannot determine latest version",
        );
      const candidate = selectRelease(
        releases,
        this.status.version,
        this.status.channel,
        this.options.arch,
      );
      if (candidate) {
        const response = await this.request(
          candidate.checksumUrl,
          true,
          bounded,
        );
        this.checksum = readChecksum(
          await this.consume(response, 1024 * 1024, bounded),
          candidate.name,
        );
      }
      this.candidate = candidate;
      this.status = {
        ...this.status,
        phase: this.candidate ? "available" : "current",
        target: this.candidate?.version,
        notes: this.candidate?.notes,
        lastCheck: new Date().toISOString(),
      };
    } else if (command.type === "download") {
      const candidate = this.candidate;
      if (!candidate || !this.directory)
        throw new Error("Check for a compatible update first");
      if (candidate.size > maxFile)
        throw new Error("Installer exceeds download limit");
      this.verified = undefined;
      this.status = {
        ...this.status,
        phase: "downloading",
        error: undefined,
        received: 0,
        total: undefined,
      };
      const bounded = AbortSignal.any([
        signal,
        AbortSignal.timeout(15 * 60 * 1000),
      ]);
      const checksumResponse = await this.request(
        candidate.checksumUrl,
        true,
        bounded,
      );
      const digest = readChecksum(
        await this.consume(checksumResponse, 1024 * 1024, bounded),
        candidate.name,
      );
      if (digest !== this.checksum)
        throw new Error("Release checksum changed; check for updates again");
      const part = join(this.directory, "download.part");
      const destination = join(this.directory, candidate.name);
      await rm(part, { force: true });
      try {
        const handle = await open(part, "wx", 0o600);
        try {
          const response = await this.request(candidate.url, true, bounded);
          await this.consume(
            response,
            candidate.size,
            bounded,
            async (chunk) => {
              await handle.writeFile(chunk);
            },
          );
          await handle.sync();
        } finally {
          await handle.close();
        }
        this.status = { ...this.status, phase: "verifying" };
        if ((await lstat(part)).size !== candidate.size)
          throw new Error("Installer size mismatch");
        await this.verify(part, digest, bounded);
        bounded.throwIfAborted();
        await rename(part, destination);
        this.verified = { path: destination, digest };
        this.status = { ...this.status, phase: "verified" };
      } finally {
        await rm(part, { force: true });
      }
    } else if (command.type === "open") {
      const verified = this.verified;
      if (!verified) throw new Error("Download and verify the installer first");
      this.status = { ...this.status, phase: "verifying", error: undefined };
      await this.verify(verified.path, verified.digest, signal);
      signal.throwIfAborted();
      const error = await this.options.openPath(verified.path);
      if (error) throw new Error(error);
      this.status = { ...this.status, phase: "verified" };
    }
    return { ...this.status };
  }
  private async verify(
    path: string,
    digest: string,
    signal: AbortSignal,
  ): Promise<void> {
    if (
      !this.directory ||
      (await realpath(this.directory)) !== this.directory ||
      (await realpath(path)) !== path ||
      !(await lstat(path)).isFile()
    )
      throw new Error("Unsafe installer cache");
    if ((await lstat(path)).size > maxFile)
      throw new Error("Installer cache exceeds limit");
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path, { signal }))
      hash.update(chunk);
    if (hash.digest("hex") !== digest)
      throw new Error("Installer SHA-256 mismatch; download again");
  }
  async close(): Promise<void> {
    this.controller?.abort();
    await this.active;
    if (this.directory)
      await rm(this.directory, { recursive: true, force: true });
  }
}
