import { useEffect, useRef } from "react";
import { routeCommand } from "./slash-commands.js";
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
  const menu = useRef<HTMLDivElement>(null);
  const selectedIndex = commandIndex % candidates.length;
  useEffect(() => {
    menu.current
      ?.querySelector(`#slash-option-${selectedIndex}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);
  return (
    <div
      ref={menu}
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
          id={`slash-option-${index}`}
          key={name}
          tabIndex={-1}
          aria-disabled={
            busy && routeCommand(`/${name}`, busy).kind === "error"
          }
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
