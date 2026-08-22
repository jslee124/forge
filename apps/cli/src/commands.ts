export interface SlashCommand {
  readonly name:
    | "/help"
    | "/new"
    | "/clear"
    | "/context"
    | "/compact"
    | "/plugins"
    | "/login"
    | "/logout"
    | "/model"
    | "/delete-model"
    | "/effort"
    | "/resume"
    | "/exit";
  readonly description: string;
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { name: "/help", description: "Show available commands" },
  { name: "/new", description: "Start a new session" },
  { name: "/clear", description: "Clear conversation context" },
  {
    name: "/context",
    description: "Show context budget and checkpoint status",
  },
  { name: "/compact", description: "Create a safe conversation checkpoint" },
  { name: "/plugins", description: "Review and manage project plugins" },
  { name: "/login", description: "Configure a model provider" },
  { name: "/logout", description: "Sign out of a model provider" },
  { name: "/model", description: "Choose a model" },
  { name: "/delete-model", description: "Delete a configured provider model" },
  { name: "/effort", description: "Choose thinking effort" },
  { name: "/resume", description: "Resume a saved workspace session" },
  { name: "/exit", description: "Exit Forge" },
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
