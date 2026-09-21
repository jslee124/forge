export interface SlashCommand {
  readonly name:
    | "/help"
    | "/new"
    | "/clear"
    | "/context"
    | "/permissions"
    | "/update-dismiss"
    | "/compact"
    | "/plugins"
    | "/resources"
    | "/login"
    | "/logout"
    | "/model"
    | "/delete-model"
    | "/effort"
    | "/resume"
    | "/exit";
  readonly description: string;
  readonly descriptionZh: string;
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  {
    name: "/help",
    description: "Show available commands",
    descriptionZh: "查看命令",
  },
  {
    name: "/new",
    description: "Start a new session",
    descriptionZh: "新建任务",
  },
  {
    name: "/clear",
    description: "Clear conversation context",
    descriptionZh: "清空上下文",
  },
  {
    name: "/context",
    description: "Show context budget and checkpoint status",
    descriptionZh: "查看上下文",
  },
  {
    name: "/permissions",
    description: "Review and revoke session permission grants",
    descriptionZh: "查看与撤销会话授权",
  },
  {
    name: "/update-dismiss",
    description: "Dismiss the currently advertised update version",
    descriptionZh: "忽略版本提示",
  },
  {
    name: "/compact",
    description: "Create a safe conversation checkpoint",
    descriptionZh: "压缩上下文",
  },
  {
    name: "/plugins",
    description: "Review and manage project plugins",
    descriptionZh: "管理插件",
  },
  {
    name: "/resources",
    description: "Review Skills and resource diagnostics",
    descriptionZh: "资源诊断",
  },
  {
    name: "/login",
    description: "Configure a model provider",
    descriptionZh: "配置提供商",
  },
  {
    name: "/logout",
    description: "Sign out of a model provider",
    descriptionZh: "退出提供商",
  },
  { name: "/model", description: "Choose a model", descriptionZh: "选择模型" },
  {
    name: "/delete-model",
    description: "Delete a configured provider model",
    descriptionZh: "删除模型",
  },
  {
    name: "/effort",
    description: "Choose thinking effort",
    descriptionZh: "推理强度",
  },
  {
    name: "/resume",
    description: "Resume a saved workspace session",
    descriptionZh: "恢复任务",
  },
  { name: "/exit", description: "Exit Forge", descriptionZh: "退出" },
];

export function filterSlashCommands(query: string): readonly SlashCommand[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized.startsWith("/")) {
    return [];
  }
  return SLASH_COMMANDS.filter((command) =>
    command.name.toLocaleLowerCase().startsWith(normalized),
  );
}

export function formatSlashCommandHelp(): string {
  const width = Math.max(...SLASH_COMMANDS.map(({ name }) => name.length));
  return [
    "Interactive commands:",
    ...SLASH_COMMANDS.map(
      ({ name, description }) => `  ${name.padEnd(width)}  ${description}`,
    ),
    "",
  ].join("\n");
}

export type ParsedSlash =
  | { kind: "message" }
  | { kind: "error"; reason: "unknown-command" | "invalid-arguments" }
  | { kind: "command"; name: SlashCommand["name"]; args: string };
export const EFFORT_ARGUMENTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
] as const;
/** Command spelling matches TUI; effort values alone are case insensitive. */
export function parseSlashCommand(input: string): ParsedSlash {
  const text = input.trim();
  if (!text.startsWith("/")) return { kind: "message" };
  const match = /^(\/[a-z-]+)(?: (.*))?$/s.exec(text);
  const entry = SLASH_COMMANDS.find(({ name }) => name === match?.[1]);
  if (!entry) return { kind: "error", reason: "unknown-command" };
  const args = match?.[2]?.trim() ?? "";
  if (
    args &&
    !(entry.name === "/compact" && text === "/compact --dry-run") &&
    !(
      entry.name === "/effort" &&
      EFFORT_ARGUMENTS.some((x) => x === args.toLowerCase())
    )
  )
    return { kind: "error", reason: "invalid-arguments" };
  return {
    kind: "command",
    name: entry.name,
    args: entry.name === "/effort" ? args.toLowerCase() : args,
  };
}
export function completeSlashCommand(
  input: string,
): readonly { name: string; description: string; descriptionZh: string }[] {
  if (/^\/[a-z-]*$/i.test(input)) return filterSlashCommands(input);
  const values = input.startsWith("/compact ")
    ? ["/compact --dry-run"]
    : input.startsWith("/effort ")
      ? EFFORT_ARGUMENTS.map((x) => `/effort ${x}`)
      : [];
  return values
    .filter((x) => x.startsWith(input.toLowerCase()))
    .map((name) => ({
      name,
      description: "Complete argument",
      descriptionZh: "补全参数",
    }));
}
