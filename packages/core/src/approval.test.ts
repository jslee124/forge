import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { ApprovalDescriptor, ApprovalScope } from "./approval.js";
import { describeApproval, SessionApprovalStore } from "./approval.js";
import type { ProposedAction } from "./policy.js";
import type { ForgeTool, ToolContext } from "./tools.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("session approval scopes", () => {
  it("reuses an exact command scope and its timeout ceiling only", async () => {
    const root = await workspace();
    const context = toolContext(root);
    const descriptor = await describeApproval(
      action("process", {
        program: "pnpm",
        args: ["test"],
        cwd: ".",
        timeoutMs: 60_000,
      }),
      context,
    );
    const store = new SessionApprovalStore({
      workspaceRoot: root,
      sessionId: "one",
    });
    store.grant(scopeOf(descriptor));

    expect(store.match(descriptor)?.useCount).toBe(2);
    expect(
      store.match(
        await describeApproval(
          action("process", {
            program: "pnpm",
            args: ["test"],
            cwd: ".",
            timeoutMs: 30_000,
          }),
          context,
        ),
      ),
    ).toBeDefined();
    for (const changed of [
      { program: "pnpm", args: ["check"], cwd: ".", timeoutMs: 60_000 },
      { program: "pnpm", args: ["test"], cwd: "src", timeoutMs: 60_000 },
      { program: "pnpm", args: ["test"], cwd: ".", timeoutMs: 90_000 },
    ]) {
      if (changed.cwd === "src") await mkdir(path.join(root, "src"));
      expect(
        store.match(
          await describeApproval(action("process", changed), context),
        ),
      ).toBeUndefined();
    }
  });

  it("canonicalizes symlink workspaces and rejects another workspace", async () => {
    const root = await workspace();
    const alias = `${root}-alias`;
    await symlink(root, alias);
    temporaryDirectories.push(alias);
    const canonical = await realpath(root);
    const descriptor = await describeApproval(
      action("write", { path: "a.ts" }),
      toolContext(alias),
    );
    const matching = new SessionApprovalStore({
      workspaceRoot: canonical,
      sessionId: "one",
    });
    matching.grant(scopeOf(descriptor));
    expect(matching.match(descriptor)).toBeDefined();

    const other = await workspace();
    const foreign = new SessionApprovalStore({
      workspaceRoot: other,
      sessionId: "two",
    });
    expect(() => foreign.grant(scopeOf(descriptor))).toThrow(
      "different workspace",
    );
  });

  it("never offers session reuse for destructive, install, or publish commands", async () => {
    const root = await workspace();
    for (const input of [
      { program: "rm", args: ["file"], cwd: ".", timeoutMs: 1_000 },
      { program: "npm", args: ["install", "x"], cwd: ".", timeoutMs: 1_000 },
      { program: "npm", args: ["publish"], cwd: ".", timeoutMs: 1_000 },
    ]) {
      const descriptor = await describeApproval(
        action("process", input),
        toolContext(root),
      );
      expect(descriptor.riskFlags.length).toBeGreaterThan(0);
      expect(descriptor.allowedScopes).toEqual([]);
    }
  });

  it("normalizes absolute executables and blocks command wrappers from reuse", async () => {
    const root = await workspace();
    const fixtures = [
      { program: "/bin/rm", args: ["-rf", "build"] },
      { program: "/usr/bin/curl", args: ["https://example.com"] },
      { program: "/usr/local/bin/npm", args: ["install", "x"] },
      { program: "/usr/local/bin/npm", args: ["publish"] },
      { program: "/usr/bin/printenv", args: ["API_SECRET"] },
      { program: "/usr/bin/env", args: ["/bin/rm", "-rf", "build"] },
      { program: "/bin/zsh", args: ["-c", "rm -rf build"] },
      { program: "/usr/bin/python3", args: ["script.py"] },
    ];
    for (const fixture of fixtures) {
      const descriptor = await describeApproval(
        action("process", {
          ...fixture,
          cwd: ".",
          timeoutMs: 1_000,
        }),
        toolContext(root),
      );
      expect(descriptor.riskFlags.length).toBeGreaterThan(0);
      expect(descriptor.allowedScopes).toEqual([]);
    }
  });

  it("binds network grants to the tool and destination host", async () => {
    const root = await workspace();
    const store = new SessionApprovalStore({
      workspaceRoot: root,
      sessionId: "one",
    });
    const first = await describeApproval(
      action("network", { url: "https://example.com/a" }, "web_fetch"),
      toolContext(root),
    );
    store.grant(scopeOf(first));
    expect(
      store.match(
        await describeApproval(
          action("network", { url: "https://example.com/b" }, "web_fetch"),
          toolContext(root),
        ),
      ),
    ).toBeDefined();
    expect(
      store.match(
        await describeApproval(
          action("network", { url: "https://example.org" }, "web_fetch"),
          toolContext(root),
        ),
      ),
    ).toBeUndefined();
  });
});

function action(
  risk: ForgeTool["risk"],
  input: unknown,
  name = risk === "process"
    ? "run_command"
    : risk === "write"
      ? "apply_patch"
      : "tool",
): ProposedAction {
  return {
    call: { id: "call", name, input },
    input,
    tool: {
      name,
      description: "test",
      inputSchema: z.unknown(),
      risk,
      execute: async () => ({ ok: true, output: null, truncated: false }),
    },
  };
}

function toolContext(root: string): ToolContext {
  return {
    workspace: { root, cwd: root },
    signal: new AbortController().signal,
    limits: {
      maxOutputBytes: 1_000,
      maxEntries: 100,
      commandTimeoutMs: 120_000,
    },
  };
}

async function workspace(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "forge-approval-"));
  temporaryDirectories.push(directory);
  return await realpath(directory);
}

function scopeOf(descriptor: ApprovalDescriptor): ApprovalScope {
  const scope = descriptor.allowedScopes[0];
  if (!scope) throw new Error("Expected an approval scope.");
  return scope;
}
