export interface SlashCommand {
  readonly name: "/help" | "/clear" | "/resume" | "/exit";
  readonly description: string;
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { name: "/help", description: "Show available commands" },
  { name: "/clear", description: "Clear conversation context" },
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
