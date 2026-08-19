/**
 * OSC 8 terminal hyperlinks.
 *
 * A long URL written as plain text is hard-wrapped by the terminal at the
 * window width. Terminals that linkify plain text apply a per-line heuristic,
 * so a wrapped URL becomes several unrelated fragments and only the first line
 * stays clickable. OSC 8 instead declares the whole URL as one explicit link
 * target, which survives wrapping.
 *
 * The visible label defaults to the URL itself, so a terminal without OSC 8
 * support still shows the complete address for manual copying.
 */

const OSC = "\u001B]";
const BEL = "\u0007";

/**
 * C0 and C1 control characters would terminate or escape the OSC 8 sequence.
 * A value containing one is never wrapped, so a hostile authentication
 * response cannot inject terminal escape sequences through this path.
 */
function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

/** Terminal emulators known to implement OSC 8. */
const HYPERLINK_TERMINAL_PROGRAMS = new Set([
  "ghostty",
  "hyper",
  "iterm.app",
  "rio",
  "tabby",
  "vscode",
  "warpterminal",
  "wezterm",
]);

/** First VTE release with OSC 8 support (GNOME Terminal, Tilix, and others). */
const MINIMUM_VTE_VERSION = 5000;

export interface HyperlinkEnvironment {
  readonly env: NodeJS.ProcessEnv;
  readonly isTTY: boolean;
}

export function supportsHyperlinks({
  env,
  isTTY,
}: HyperlinkEnvironment): boolean {
  // `NodeJS.ProcessEnv` reaches these through an index signature, which
  // `noPropertyAccessFromIndexSignature` forbids reading as properties.
  const variables = env as {
    FORCE_HYPERLINK?: string;
    KONSOLE_VERSION?: string;
    TERM?: string;
    TERM_PROGRAM?: string;
    VTE_VERSION?: string;
    WT_SESSION?: string;
  };
  // An explicit override wins over detection in both directions, so a user on
  // an unrecognized terminal can still get clickable links.
  const forced = variables.FORCE_HYPERLINK;
  if (forced !== undefined && forced !== "") {
    const normalized = forced.toLocaleLowerCase();
    return normalized !== "0" && normalized !== "false";
  }
  // Redirected or piped output must stay plain so scripts and traces receive
  // the bare URL.
  if (!isTTY) return false;
  // NO_COLOR signals a request for undecorated output.
  if ("NO_COLOR" in env) return false;
  const term = variables.TERM;
  if (term === "dumb") return false;
  if (term === "xterm-kitty") return true;
  const terminalProgram = variables.TERM_PROGRAM?.toLocaleLowerCase();
  if (terminalProgram && HYPERLINK_TERMINAL_PROGRAMS.has(terminalProgram)) {
    return true;
  }
  // Windows Terminal and Konsole do not set TERM_PROGRAM.
  if (variables.WT_SESSION !== undefined) return true;
  if (variables.KONSOLE_VERSION !== undefined) return true;
  const vteVersion = Number.parseInt(variables.VTE_VERSION ?? "", 10);
  if (Number.isFinite(vteVersion) && vteVersion >= MINIMUM_VTE_VERSION) {
    return true;
  }
  return false;
}

/**
 * Wrap `url` in an OSC 8 hyperlink when the terminal supports it, otherwise
 * return the URL unchanged.
 */
export function terminalHyperlink(
  url: string,
  environment: HyperlinkEnvironment,
  label: string = url,
): string {
  if (containsControlCharacter(url) || containsControlCharacter(label)) {
    return url;
  }
  if (!supportsHyperlinks(environment)) return url;
  return `${OSC}8;;${url}${BEL}${label}${OSC}8;;${BEL}`;
}
