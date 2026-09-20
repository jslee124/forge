import {
  completeSlashCommand,
  parseSlashCommand,
  SLASH_COMMANDS,
} from "@forge/application/slash-commands";

function availability(name: string, zh: boolean): string {
  if (["/resources", "/logout", "/delete-model", "/effort"].includes(name))
    return zh ? " · 尚未接入" : " · not connected";
  if (name === "/update-dismiss") return zh ? " · 不适用" : " · not applicable";
  if (["/login", "/plugins", "/permissions"].includes(name))
    return zh ? " · 部分支持" : " · partial";
  return "";
}
export const commands = SLASH_COMMANDS.map(
  (x) =>
    [
      x.name.slice(1),
      x.descriptionZh + availability(x.name, true),
      x.description + availability(x.name, false),
    ] as const,
);
export function parseSlash(text: string) {
  const parsed = parseSlashCommand(text);
  return parsed.kind === "command"
    ? { name: parsed.name.slice(1), args: parsed.args }
    : undefined;
}
export function suggestions(text: string) {
  return completeSlashCommand(text).map(
    (x) =>
      [
        x.name.slice(1),
        x.descriptionZh + availability(x.name, true),
        x.description + availability(x.name, false),
      ] as const,
  );
}
export type CommandResult =
  | {
      kind: "open";
      target: "model" | "permissions" | "resume" | "settings" | "exit";
    }
  | { kind: "read"; target: "help" | "context" }
  | { kind: "manage"; target: "reset" | "compact" }
  | {
      kind: "error";
      reason: "unknown-command" | "invalid-arguments" | "busy" | "unsupported";
    }
  | { kind: "not-applicable" };
export function routeCommand(input: string, busy: boolean): CommandResult {
  const p = parseSlashCommand(input);
  if (p.kind !== "command")
    return {
      kind: "error",
      reason: p.kind === "error" ? p.reason : "unknown-command",
    };
  if (p.name === "/help" || p.name === "/context")
    return { kind: "read", target: p.name === "/help" ? "help" : "context" };
  if (p.name === "/update-dismiss") return { kind: "not-applicable" };
  if (busy) return { kind: "error", reason: "busy" };
  // P2 owns dry-run and effort execution; parsing must never turn them into a normal run.
  if (p.args) return { kind: "error", reason: "unsupported" };
  if (p.name === "/new" || p.name === "/clear")
    return { kind: "manage", target: "reset" };
  if (p.name === "/compact") return { kind: "manage", target: "compact" };
  if (p.name === "/login" || p.name === "/plugins")
    return { kind: "open", target: "settings" };
  if (
    p.name === "/model" ||
    p.name === "/permissions" ||
    p.name === "/resume" ||
    p.name === "/exit"
  )
    return {
      kind: "open",
      target: p.name.slice(1) as "model" | "permissions" | "resume" | "exit",
    };
  return { kind: "error", reason: "unsupported" };
}
