import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import path from "node:path";

import type { ProposedAction } from "./policy.js";
import type { ToolContext, ToolResult, ToolRisk } from "./tools.js";

interface ApprovalInputFields {
  readonly args?: unknown;
  readonly cwd?: unknown;
  readonly path?: unknown;
  readonly program?: unknown;
  readonly timeoutMs?: unknown;
  readonly url?: unknown;
  readonly [key: string]: unknown;
}

export type ApprovalResponseKind =
  | "allow-once"
  | "allow-session"
  | "deny"
  | "preflight-failed";

export type ApprovalResponse =
  | { readonly kind: "allow-once" }
  | { readonly kind: "allow-session" }
  | { readonly kind: "deny"; readonly feedback?: string }
  | { readonly kind: "preflight-failed"; readonly result: ToolResult };

export type ApprovalRiskFlag =
  | "broad-external-effect"
  | "credential-sensitive"
  | "destructive"
  | "install"
  | "policy-designated"
  | "publish";

export type ApprovalScope =
  | {
      readonly kind: "workspace-write";
      readonly workspaceRoot: string;
    }
  | {
      readonly kind: "command";
      readonly workspaceRoot: string;
      readonly program: string;
      readonly args: readonly string[];
      readonly cwd: string;
      readonly timeoutCeilingMs: number;
    }
  | {
      readonly kind: "network";
      readonly workspaceRoot: string;
      readonly tool: string;
      readonly destination: string;
    }
  | {
      readonly kind: "delegated-model";
      readonly workspaceRoot: string;
      readonly tool: string;
    };

export interface ApprovalDescriptor {
  readonly actionId: string;
  readonly effect: ToolRisk;
  readonly resource: string;
  readonly preview: string;
  readonly riskFlags: readonly ApprovalRiskFlag[];
  readonly allowedScopes: readonly ApprovalScope[];
}

export interface SessionGrant {
  readonly id: string;
  readonly scope: ApprovalScope;
  readonly createdAt: string;
  readonly useCount: number;
}

export class SessionApprovalStore {
  readonly workspaceRoot: string;
  readonly sessionId: string;
  readonly #grants = new Map<string, SessionGrant>();

  constructor(options: {
    readonly workspaceRoot: string;
    readonly sessionId: string;
  }) {
    this.workspaceRoot = options.workspaceRoot;
    this.sessionId = options.sessionId;
  }

  list(): readonly SessionGrant[] {
    return [...this.#grants.values()];
  }

  revoke(id: string): boolean {
    return this.#grants.delete(id);
  }

  clear(): void {
    this.#grants.clear();
  }

  grant(scope: ApprovalScope, now = new Date()): SessionGrant {
    if (scope.workspaceRoot !== this.workspaceRoot) {
      throw new Error("Approval scope belongs to a different workspace.");
    }
    const id = approvalScopeId(scope);
    const existing = this.#grants.get(id);
    if (existing) return existing;
    const grant = { id, scope, createdAt: now.toISOString(), useCount: 1 };
    this.#grants.set(id, grant);
    return grant;
  }

  match(descriptor: ApprovalDescriptor): SessionGrant | undefined {
    if (descriptor.riskFlags.length > 0) return undefined;
    for (const allowed of descriptor.allowedScopes) {
      const grant = [...this.#grants.values()].find((candidate) =>
        scopeCovers(candidate.scope, allowed),
      );
      if (!grant) continue;
      const used = { ...grant, useCount: grant.useCount + 1 };
      this.#grants.set(grant.id, used);
      return used;
    }
    return undefined;
  }
}

export async function describeApproval(
  action: ProposedAction,
  context: ToolContext,
): Promise<ApprovalDescriptor> {
  const workspaceRoot = await canonicalPath(context.workspace.root);
  const input = asRecord(action.input);
  const riskFlags = riskFlagsFor(action.tool.risk, action.tool.name, input);
  let resource = action.tool.name;
  let preview = action.tool.name;
  let scope: ApprovalScope | undefined;

  if (action.tool.risk === "write") {
    resource = typeof input.path === "string" ? input.path : workspaceRoot;
    preview = `${action.tool.name} ${resource}`;
    scope = { kind: "workspace-write", workspaceRoot };
  } else if (action.tool.risk === "process") {
    const program =
      typeof input.program === "string" ? input.program : action.tool.name;
    const args = Array.isArray(input.args)
      ? input.args.filter((value): value is string => typeof value === "string")
      : [];
    const requestedCwd = typeof input.cwd === "string" ? input.cwd : ".";
    const cwd = await canonicalPath(
      path.resolve(context.workspace.cwd, requestedCwd),
    );
    const requestedTimeout =
      typeof input.timeoutMs === "number" ? input.timeoutMs : 0;
    const timeoutCeilingMs = Math.min(
      requestedTimeout,
      context.limits.commandTimeoutMs ?? requestedTimeout,
    );
    resource = `${program} ${args.join(" ")}`.trim();
    preview = `${resource}\n${cwd} · ${timeoutCeilingMs}ms`;
    scope = {
      kind: "command",
      workspaceRoot,
      program,
      args,
      cwd,
      timeoutCeilingMs,
    };
  } else if (action.tool.risk === "network") {
    const destination = networkDestination(action.tool.name, input);
    resource = destination;
    preview = `${action.tool.name} → ${destination}`;
    scope = {
      kind: "network",
      workspaceRoot,
      tool: action.tool.name,
      destination,
    };
  } else if (action.tool.risk === "model") {
    resource = action.tool.name;
    preview = `${action.tool.name} delegated model`;
    scope = {
      kind: "delegated-model",
      workspaceRoot,
      tool: action.tool.name,
    };
  }

  const allowedScopes = scope && riskFlags.length === 0 ? [scope] : [];
  return {
    actionId: action.call.id,
    effect: action.tool.risk,
    resource,
    preview,
    riskFlags,
    allowedScopes,
  };
}

export function approvalScopeId(scope: ApprovalScope): string {
  return createHash("sha256")
    .update(stableJson(scope))
    .digest("hex")
    .slice(0, 16);
}

export function formatApprovalScope(scope: ApprovalScope): string {
  switch (scope.kind) {
    case "workspace-write":
      return `workspace writes in ${scope.workspaceRoot}`;
    case "command":
      return `${scope.program} ${scope.args.join(" ")} in ${scope.cwd} (timeout ≤ ${scope.timeoutCeilingMs}ms)`;
    case "network":
      return `${scope.tool} to ${scope.destination}`;
    case "delegated-model":
      return `delegated model tool ${scope.tool}`;
  }
}

function scopeCovers(grant: ApprovalScope, requested: ApprovalScope): boolean {
  if (
    grant.kind !== requested.kind ||
    grant.workspaceRoot !== requested.workspaceRoot
  ) {
    return false;
  }
  if (grant.kind === "command" && requested.kind === "command") {
    return (
      grant.program === requested.program &&
      stableJson(grant.args) === stableJson(requested.args) &&
      grant.cwd === requested.cwd &&
      requested.timeoutCeilingMs <= grant.timeoutCeilingMs
    );
  }
  return approvalScopeId(grant) === approvalScopeId(requested);
}

async function canonicalPath(value: string): Promise<string> {
  try {
    return await realpath(value);
  } catch {
    return path.resolve(value);
  }
}

function networkDestination(tool: string, input: ApprovalInputFields): string {
  if (typeof input.url === "string") {
    try {
      return new URL(input.url).host.toLocaleLowerCase();
    } catch {
      return "invalid-destination";
    }
  }
  return `service:${tool}`;
}

function riskFlagsFor(
  risk: ToolRisk,
  tool: string,
  input: ApprovalInputFields,
): readonly ApprovalRiskFlag[] {
  if (risk !== "process") return [];
  const program =
    typeof input.program === "string"
      ? input.program.toLocaleLowerCase()
      : tool;
  const args = Array.isArray(input.args)
    ? input.args
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.toLocaleLowerCase())
    : [];
  const executable = executableBasename(program);
  const words = [executable, ...args.map(executableBasename)];
  const flags = new Set<ApprovalRiskFlag>();
  if (
    /^(?:a|ba|da|fi|k|tc|z)?sh$/u.test(executable) ||
    /^(?:bun|deno|env|java|js|lua|luajit|node|nodejs|osascript|perl|php|powershell|pwsh|python\d*(?:\.\d+)?|qjs|rscript|ruby)$/u.test(
      executable,
    )
  ) {
    flags.add("broad-external-effect");
  }
  if (words.some((word) => /^(?:rm|rmdir|shred|diskutil|mkfs)$/u.test(word)))
    flags.add("destructive");
  if (words.some((word) => /^(?:publish|deploy|release)$/u.test(word)))
    flags.add("publish");
  if (words.some((word) => /^(?:install|add|link|uninstall)$/u.test(word)))
    flags.add("install");
  if (words.some((word) => /(?:token|credential|keychain|secret)/u.test(word)))
    flags.add("credential-sensitive");
  if (
    words.some((word) =>
      /^(?:curl|ftp|nc|ncat|rsync|scp|sftp|ssh|sudo|telnet|wget)$/u.test(word),
    )
  )
    flags.add("broad-external-effect");
  return [...flags].sort();
}

function executableBasename(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/\/+$/u, "");
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

function asRecord(value: unknown): ApprovalInputFields {
  return value !== null && typeof value === "object"
    ? (value as ApprovalInputFields)
    : {};
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
