import { createHash, randomUUID } from "node:crypto";
import {
  link,
  mkdir,
  readFile,
  realpath,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Coordinates cooperating processes on this host, independently of FORGE_HOME. */
export class ExecutionLease {
  #released = false;
  #compatibilityLease: ExecutionLease | undefined;
  private constructor(
    readonly key: string,
    private readonly file: string,
    private readonly owner: string,
  ) {}

  static async acquire(key: string): Promise<ExecutionLease> {
    // POSIX launchers may supply different TMPDIR values. The primary lease
    // must still be shared by a GUI launched from Finder and a terminal process.
    const base = await realpath(
      process.platform === "win32" ? tmpdir() : "/tmp",
    );
    const legacyBase = await realpath(tmpdir());
    const name = `forge-execution-${process.getuid?.() ?? "user"}`;
    const lease = await ExecutionLease.#acquireInDirectory(
      key,
      join(base, name),
    );
    try {
      // Also honor running older builds that use this launcher's temp directory.
      if (legacyBase !== base)
        lease.#compatibilityLease = await ExecutionLease.#acquireInDirectory(
          key,
          join(legacyBase, name),
        );
      return lease;
    } catch (error) {
      await lease.release();
      throw error;
    }
  }

  static async #acquireInDirectory(
    key: string,
    directory: string,
  ): Promise<ExecutionLease> {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const file = join(
      directory,
      createHash("sha256").update(key).digest("hex"),
    );
    const owner = JSON.stringify({ pid: process.pid, nonce: randomUUID() });
    const candidate = `${file}.${randomUUID()}`;
    await writeFile(candidate, owner, { flag: "wx", mode: 0o600 });
    try {
      try {
        await link(candidate, file);
      } catch (error) {
        if (!isCode(error, "EEXIST")) throw error;
        // Serialize stale reclamation. A crashed reclamation guard fails closed.
        const guard = `${file}.recovery`;
        try {
          await writeFile(guard, owner, { flag: "wx", mode: 0o600 });
        } catch {
          throw new Error("workspace-busy: lease recovery in progress");
        }
        try {
          const previous = await readFile(file, "utf8").catch((e: unknown) => {
            if (isCode(e, "ENOENT")) return undefined;
            throw e;
          });
          if (previous !== undefined) {
            const data: unknown = JSON.parse(previous);
            const pid = (data as { pid?: unknown })?.pid;
            if (
              typeof pid !== "number" ||
              !Number.isSafeInteger(pid) ||
              pid <= 0
            )
              throw new Error("workspace-busy: invalid lease");
            try {
              process.kill(pid, 0);
              throw new Error("workspace-busy");
            } catch (e) {
              if (!isCode(e, "ESRCH")) throw new Error("workspace-busy");
            }
            await unlink(file);
          }
          try {
            await link(candidate, file);
          } catch {
            throw new Error("workspace-busy");
          }
        } finally {
          await unlink(guard);
        }
      }
      return new ExecutionLease(key, file, owner);
    } finally {
      await unlink(candidate);
    }
  }

  async assertWorkspace(root: string): Promise<void> {
    if (
      this.#released ||
      this.key !== `workspace:${await realpath(root)}` ||
      (await readFile(this.file, "utf8")) !== this.owner
    )
      throw new Error("invalid-workspace-lease");
  }

  async release(): Promise<void> {
    if (this.#released) return;
    this.#released = true;
    try {
      await this.#compatibilityLease?.release();
    } finally {
      if ((await readFile(this.file, "utf8")) === this.owner)
        await unlink(this.file);
    }
  }
}

export async function acquireWorkspaceLease(
  root: string,
): Promise<ExecutionLease> {
  return ExecutionLease.acquire(`workspace:${await realpath(root)}`);
}

function isCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
