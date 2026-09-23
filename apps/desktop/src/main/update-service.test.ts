import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { updateCommandSchema } from "../shared/update-protocol.js";
import {
  compareVersions,
  parseVersion,
  type Release,
  readChecksum,
  repository,
  selectRelease,
} from "./update-release.js";
import { UpdateService, validateUpdateUrl } from "./update-service.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open) };
});

const bytes = Buffer.from("controlled installer fixture");
const digest = createHash("sha256").update(bytes).digest("hex");
function release(version = "0.3.4-preview.2"): Release {
  const name = "forge-desktop-0.3.4-arm64.dmg";
  return {
    tag_name: `desktop-${version}`,
    draft: false,
    prerelease: version.includes("-"),
    body: "<script>remote notes</script>",
    assets: [name, "SHA256SUMS"].map((name) => ({
      name,
      size: bytes.length,
      browser_download_url: `https://github.com/${repository}/releases/download/desktop-${version}/${name}`,
    })),
  };
}
const roots: string[] = [];
const services: UpdateService[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(services.splice(0).map((s) => s.close()));
  await Promise.all(
    roots.splice(0).map((r) => rm(r, { recursive: true, force: true })),
  );
});
async function setup(
  override?: typeof fetch,
  version: string | null = "0.3.4-preview.1",
  platform: "darwin" | "win32" = "darwin",
) {
  const root = await mkdtemp(join(tmpdir(), "forge-update-test-"));
  roots.push(root);
  const request = vi.fn<typeof fetch>(
    override ??
      (async (url) => {
        const value = String(url);
        if (value.includes("api.github.com")) return Response.json([release()]);
        if (value.endsWith("SHA256SUMS"))
          return new Response(`${digest}  forge-desktop-0.3.4-arm64.dmg\n`);
        return new Response(bytes, {
          headers: { "content-length": String(bytes.length) },
        });
      }),
  );
  const openPath = vi.fn(async (_path: string) => "");
  const service = new UpdateService({
    root,
    version,
    platform,
    arch: "arm64",
    startupAllowed: false,
    fetch: request,
    openPath,
  });
  services.push(service);
  await service.initialize();
  return { service, request, root, openPath };
}
describe("desktop release contract", () => {
  it("orders semantic versions, stable and numeric preview identities", () => {
    expect(compareVersions("0.3.4-preview.10", "0.3.4-preview.2")).toBe(1);
    expect(compareVersions("0.3.4", "0.3.4-preview.99")).toBe(1);
    expect(compareVersions("0.10.0", "0.9.99")).toBe(1);
    expect(compareVersions("0.3.4+one", "0.3.4+two")).toBe(0);
    expect(compareVersions("1.0.0-a", "1.0.0-a.1")).toBe(-1);
    expect(() => parseVersion("0.3.4-preview.01")).toThrow();
  });
  it("excludes CLI tags, drafts, invalid tags, older and equal builds", () => {
    expect(
      selectRelease(
        [
          { ...release(), tag_name: "v9.0.0" },
          { ...release(), draft: true },
          { ...release(), tag_name: "desktop-invalid" },
          release("0.3.4-preview.1"),
        ],
        "0.3.4-preview.1",
        "preview",
        "darwin",
        "arm64",
      ),
    ).toBeUndefined();
    expect(
      selectRelease(
        [release()],
        "0.3.4-preview.1",
        "stable",
        "darwin",
        "arm64",
      ),
    ).toBeUndefined();
    expect(
      selectRelease(
        [release("0.3.4")],
        "0.3.4-preview.1",
        "preview",
        "darwin",
        "arm64",
      )?.version,
    ).toBe("0.3.4");
    expect(
      selectRelease([release()], "0.3.4", "preview", "darwin", "arm64"),
    ).toBeUndefined();
  });
  it("requires exact architecture assets and same-release checksums", () => {
    expect(
      selectRelease([release()], "0.3.3", "preview", "darwin", "x64"),
    ).toBeUndefined();
    const r = release();
    r.assets = r.assets.filter((a) => a.name !== "SHA256SUMS");
    expect(() =>
      selectRelease([r], "0.3.3", "preview", "darwin", "arm64"),
    ).toThrow();
    expect(() =>
      readChecksum(`${digest}  a.dmg\n${digest}  a.dmg`, "a.dmg"),
    ).toThrow();
    expect(() => readChecksum(`${digest}  ../a.dmg`, "a.dmg")).toThrow();
  });
  it("rejects untrusted redirect hosts, schemes, credentials and arbitrary IPC fields", () => {
    for (const url of [
      "http://github.com/a",
      "https://github.com.evil.test/a",
      "https://user@github.com/a",
      "file:///a",
      "https://api.github.com/repos/other/repo/releases",
      "https://objects.githubusercontent.com/a",
    ])
      expect(() => validateUpdateUrl(url, true)).toThrow();
    expect(
      validateUpdateUrl(
        "https://release-assets.githubusercontent.com/a?token=x",
        true,
        true,
      ).hostname,
    ).toBe("release-assets.githubusercontent.com");
    expect(
      updateCommandSchema.safeParse({ type: "open", path: "/tmp/evil" })
        .success,
    ).toBe(false);
  });
});
describe("desktop update lifecycle", () => {
  it("never checks on development startup and reports missing build identity", async () => {
    const { service, request } = await setup(undefined, null);
    service.start();
    expect(request).not.toHaveBeenCalled();
    expect((await service.command({ type: "check" })).error).toContain(
      "identity",
    );
    expect(request).not.toHaveBeenCalled();
  });
  it("checks, downloads, hashes, opens without exiting, then rejects tampering", async () => {
    const { service, request, root, openPath } = await setup();
    expect((await service.command({ type: "check" })).phase).toBe("available");
    expect(request).toHaveBeenCalledTimes(2);
    expect((await service.command({ type: "download" })).phase).toBe(
      "verified",
    );
    expect(openPath).not.toHaveBeenCalled();
    expect((await service.command({ type: "open" })).phase).toBe("verified");
    const directory = (await readdir(root)).find((name) =>
      name.startsWith("session-"),
    );
    const path = join(
      root,
      directory ?? "missing",
      "forge-desktop-0.3.4-arm64.dmg",
    );
    expect(await readFile(path)).toEqual(bytes);
    await writeFile(path, "tampered");
    expect((await service.command({ type: "open" })).error).toContain(
      "SHA-256",
    );
    expect(openPath).toHaveBeenCalledTimes(1);
    expect((await service.command({ type: "download" })).phase).toBe(
      "verified",
    );
  });
  it("rejects checksum mismatch and removes temporary files", async () => {
    const { service, root } = await setup(async (url) =>
      String(url).includes("api.github")
        ? Response.json([release()])
        : String(url).endsWith("SHA256SUMS")
          ? new Response(`${"a".repeat(64)}  forge-desktop-0.3.4-arm64.dmg`)
          : new Response(bytes),
    );
    await service.command({ type: "check" });
    expect((await service.command({ type: "download" })).phase).toBe("failed");
    const directory = (await readdir(root)).find((name) =>
      name.startsWith("session-"),
    );
    expect(await readdir(join(root, directory ?? "missing"))).toEqual([]);
  });
  it("bounds enumeration and does not claim up to date on incomplete pages", async () => {
    const { service, request } = await setup(async () =>
      Response.json(
        Array.from({ length: 100 }, () => ({
          ...release(),
          tag_name: "v0.3.4",
        })),
      ),
    );
    const result = await service.command({ type: "check" });
    expect(result.phase).toBe("failed");
    expect(result.error).toContain("incomplete");
    expect(request).toHaveBeenCalledTimes(10);
  });
  it("reads later release pages instead of relying on GitHub latest", async () => {
    const { service } = await setup(async (url) =>
      String(url).endsWith("SHA256SUMS")
        ? new Response(`${digest}  forge-desktop-0.3.4-arm64.dmg`)
        : Response.json(
            String(url).endsWith("page=1")
              ? Array.from({ length: 100 }, () => ({
                  ...release(),
                  tag_name: "v0.3.4",
                }))
              : [release()],
          ),
    );
    expect((await service.command({ type: "check" })).target).toBe(
      "0.3.4-preview.2",
    );
  });
  it("deduplicates clicks and preserves notice after cancellation", async () => {
    const { service, request } = await setup(async (url, options) => {
      if (String(url).includes("api.github")) return Response.json([release()]);
      if (String(url).endsWith("SHA256SUMS"))
        return new Response(`${digest}  forge-desktop-0.3.4-arm64.dmg`);
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener(
          "abort",
          () => reject(new Error("aborted")),
          { once: true },
        );
      });
    });
    await service.command({ type: "check" });
    const first = service.command({ type: "download" }),
      second = service.command({ type: "download" });
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(4));
    await service.command({ type: "cancel" });
    expect((await first).phase).toBe("available");
    expect((await second).target).toBe("0.3.4-preview.2");
    expect(request).toHaveBeenCalledTimes(4);
  });
  it("reports rate limits, offline errors and rejected redirects", async () => {
    for (const response of [
      new Response("", { status: 429 }),
      new Response("", {
        status: 302,
        headers: { location: "https://evil.test/a" },
      }),
    ]) {
      const { service } = await setup(async () => response);
      expect((await service.command({ type: "check" })).phase).toBe("failed");
    }
    const { service } = await setup(async () => {
      throw new Error("offline");
    });
    expect((await service.command({ type: "check" })).error).toBe("offline");
  });
  it("persists preferences outside session data and checks after channel change", async () => {
    const { service, root, request } = await setup();
    await service.command({
      type: "preferences",
      channel: "stable",
      startup: false,
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(await readFile(join(root, "preferences.json"), "utf8")),
    ).toEqual({ channel: "stable", startup: false });
  });
  it("handles unavailable cache/disk without opening files", async () => {
    const { service, root, openPath } = await setup();
    await service.command({ type: "check" });
    await rm(root, { recursive: true });
    expect((await service.command({ type: "download" })).phase).toBe("failed");
    expect(openPath).not.toHaveBeenCalled();
  });
});

describe("update fault boundaries", () => {
  it("reports network timeout without claiming current", async () => {
    const { service } = await setup();
    vi.spyOn(AbortSignal, "timeout").mockReturnValueOnce(
      AbortSignal.abort(new DOMException("Fixture timeout", "TimeoutError")),
    );
    const result = await service.command({ type: "check" });
    expect(result.phase).toBe("failed");
    expect(result.error).toContain("timeout");
    expect(result.lastCheck).toBeUndefined();
  });
  it("reports ENOSPC and cleans partial download", async () => {
    const { service, root, openPath } = await setup();
    await service.command({ type: "check" });
    vi.mocked(fs.open).mockRejectedValueOnce(
      Object.assign(new Error("ENOSPC: disk full"), { code: "ENOSPC" }),
    );
    const result = await service.command({ type: "download" });
    expect(result.error).toContain("ENOSPC");
    const directory = (await readdir(root)).find((name) =>
      name.startsWith("session-"),
    );
    expect(await readdir(join(root, directory ?? "missing"))).toEqual([]);
    expect(openPath).not.toHaveBeenCalled();
  });
  it("bounds redirects, response sizes and installer size", async () => {
    const { service, request } = await setup(
      async () =>
        new Response("", {
          status: 302,
          headers: {
            location: `https://api.github.com/repos/${repository}/releases`,
          },
        }),
    );
    expect((await service.command({ type: "check" })).error).toContain(
      "redirects",
    );
    expect(request).toHaveBeenCalledTimes(5);
    const huge = await setup(
      async () =>
        new Response("[]", { headers: { "content-length": "999999999" } }),
    );
    expect((await huge.service.command({ type: "check" })).error).toContain(
      "large",
    );
  });
  it("persists channel and preference across restart without trusting prior installers", async () => {
    const { service, root, request } = await setup();
    await service.command({
      type: "preferences",
      channel: "stable",
      startup: false,
    });
    await service.close();
    const restarted = new UpdateService({
      root,
      version: "0.3.4-preview.1",
      platform: "darwin",
      arch: "arm64",
      startupAllowed: true,
      fetch: request,
      openPath: async () => "",
    });
    services.push(restarted);
    await restarted.initialize();
    expect(restarted.status.channel).toBe("stable");
    expect(restarted.status.startup).toBe(false);
    expect((await restarted.command({ type: "open" })).phase).toBe("failed");
  });
  it("selects x64 on Rosetta without migrating to arm64", () => {
    const r = release();
    const arm = r.assets[0];
    if (!arm) throw new Error("Missing fixture");
    r.assets.push({
      ...arm,
      name: arm.name.replace("arm64", "x64"),
      browser_download_url: arm.browser_download_url.replace("arm64", "x64"),
    });
    expect(selectRelease([r], "0.3.3", "preview", "darwin", "x64")?.name).toBe(
      "forge-desktop-0.3.4-x64.dmg",
    );
  });
  it("selects the Windows installer and skips newer releases for another platform", () => {
    const windows = release("0.3.4-preview.3");
    windows.assets = windows.assets.map((asset) => ({
      ...asset,
      name: asset.name.replace("arm64.dmg", "x64.exe"),
      browser_download_url: asset.browser_download_url.replace(
        "arm64.dmg",
        "x64.exe",
      ),
    }));
    const mac = release("0.3.4-preview.2");
    expect(
      selectRelease(
        [windows, mac],
        "0.3.4-preview.1",
        "preview",
        "darwin",
        "arm64",
      )?.version,
    ).toBe("0.3.4-preview.2");
    expect(
      selectRelease(
        [windows, mac],
        "0.3.4-preview.1",
        "preview",
        "win32",
        "x64",
      )?.name,
    ).toBe("forge-desktop-0.3.4-x64.exe");
  });
});

it("does not offer incomplete checksum releases as downloadable", async () => {
  const { service } = await setup(async (url) =>
    String(url).includes("api.github")
      ? Response.json([release()])
      : new Response("invalid sums"),
  );
  const result = await service.command({ type: "check" });
  expect(result.phase).toBe("failed");
  expect(result.retry).toBe("check");
  expect(result.target).toBeUndefined();
});
it("rejects managed-directory symlink substitution before writing", async () => {
  const { service, root } = await setup();
  await service.command({ type: "check" });
  const directory = (await readdir(root)).find((name) =>
    name.startsWith("session-"),
  );
  const path = join(root, directory ?? "missing");
  await rm(path, { recursive: true });
  const outside = await mkdtemp(join(tmpdir(), "forge-update-outside-"));
  roots.push(outside);
  await fs.symlink(outside, path);
  expect((await service.command({ type: "download" })).error).toContain(
    "Unsafe",
  );
  expect(await readdir(outside)).toEqual([]);
});
