export function SlashCommandMenu({
  candidates,
  commandIndex,
  busy,
  zh,
  executeSlash,
}: {
  candidates: readonly (readonly [string, string, string])[];
  commandIndex: number;
  busy: boolean;
  zh: boolean;
  executeSlash: (input: string) => Promise<void>;
}) {
  return (
    <div
      className="studio-slash-menu"
      role="listbox"
      id="slash-menu"
      aria-label={zh ? "命令" : "Commands"}
    >
      {candidates.map(([name, cn, en], index) => (
        <button
          type="button"
          role="option"
          aria-selected={index === commandIndex % candidates.length}
          key={name}
          disabled={busy}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void executeSlash(`/${name}`)}
        >
          <strong>/{name}</strong>
          <span>{zh ? cn : en}</span>
        </button>
      ))}
      <small>↑↓ · Tab · Enter · Esc</small>
    </div>
  );
}
