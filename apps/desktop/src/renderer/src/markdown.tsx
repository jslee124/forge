import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ThemedToken } from "shiki/core";
import { createHighlighterCore } from "shiki/core";
import tsx from "shiki/dist/langs/tsx.mjs";
import githubLight from "shiki/dist/themes/github-light.mjs";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

const highlighter = createHighlighterCore({
  themes: [githubLight],
  langs: [tsx],
  engine: createJavaScriptRegexEngine(),
});

type SafeToken = {
  key: string;
  content: string;
  color: string | undefined;
  fontStyle: number | undefined;
};
type SafeLine = { key: string; tokens: SafeToken[] };

function stableKey(text: string, offset: number): string {
  let hash = 2166136261;
  for (const character of text)
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `${(hash >>> 0).toString(36)}-${offset}`;
}

function makeSafeLines(lines: ThemedToken[][]): SafeLine[] {
  let offset = 0;
  return lines.map((line) => {
    const text = line.map((token) => token.content).join("");
    const safeLine: SafeLine = { key: stableKey(text, offset), tokens: [] };
    for (const token of line) {
      safeLine.tokens.push({
        key: stableKey(token.content, offset),
        content: token.content,
        color: token.color,
        fontStyle: token.fontStyle,
      });
      offset += token.content.length + 1;
    }
    return safeLine;
  });
}

function HighlightedCode({
  language,
  value,
}: {
  language: string;
  value: string;
}): React.JSX.Element {
  const [tokens, setTokens] = React.useState<SafeLine[] | null>(null);
  React.useEffect(() => {
    let active = true;
    void highlighter
      .then((instance) =>
        instance.codeToTokens(value, { lang: language, theme: "github-light" }),
      )
      .then((result) => {
        if (active) setTokens(makeSafeLines(result.tokens));
      })
      .catch(() => {
        if (active) setTokens(null);
      });
    return () => {
      active = false;
    };
  }, [language, value]);
  if (!tokens)
    return (
      <pre className="code-fallback">
        <code>{value}</code>
      </pre>
    );
  return (
    <div className="highlighted-code">
      <pre>
        <code>
          {tokens.map((line, lineIndex) => (
            <React.Fragment key={line.key}>
              {line.tokens.map((token) => (
                <span
                  key={token.key}
                  style={{
                    color: token.color,
                    fontStyle:
                      token.fontStyle && token.fontStyle & 1
                        ? "italic"
                        : undefined,
                    fontWeight:
                      token.fontStyle && token.fontStyle & 2
                        ? "bold"
                        : undefined,
                    textDecoration:
                      token.fontStyle && token.fontStyle & 4
                        ? "underline"
                        : undefined,
                  }}
                >
                  {token.content}
                </span>
              ))}
              {lineIndex < tokens.length - 1 ? "\n" : null}
            </React.Fragment>
          ))}
        </code>
      </pre>
    </div>
  );
}

export function Markdown({
  children,
}: {
  children: string;
}): React.JSX.Element {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ className, children: codeChildren }) {
          const match = /language-(\w+)/.exec(className ?? "");
          const value = String(codeChildren).replace(/\n$/, "");
          return match ? (
            <HighlightedCode language={match[1] ?? "text"} value={value} />
          ) : (
            <code>{value}</code>
          );
        },
        a({ href, children: linkChildren }) {
          return (
            <a href={href} onClick={(event) => event.preventDefault()}>
              {linkChildren}
            </a>
          );
        },
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
