import React from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ThemedToken } from "shiki/core";
import { createHighlighterCore } from "shiki/core";
import tsx from "shiki/dist/langs/tsx.mjs";
import githubDark from "shiki/dist/themes/github-dark.mjs";
import githubLight from "shiki/dist/themes/github-light.mjs";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { CopyButton } from "./copy-button.js";
import { useTheme } from "./theme.js";

const highlighter = createHighlighterCore({
  themes: [githubLight, githubDark],
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
  const { resolved } = useTheme();
  const [tokens, setTokens] = React.useState<SafeLine[] | null>(null);
  React.useEffect(() => {
    let active = true;
    void highlighter
      .then((instance) =>
        instance.codeToTokens(value, {
          lang: language,
          theme: resolved === "dark" ? "github-dark" : "github-light",
        }),
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
  }, [language, value, resolved]);
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

export const Markdown = React.memo(function Markdown({
  children,
}: {
  children: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        pre({ children: blockChildren }) {
          const child = React.Children.toArray(blockChildren)[0];
          if (
            !React.isValidElement<{
              className?: string;
              children?: React.ReactNode;
            }>(child)
          )
            return <pre>{blockChildren}</pre>;
          const language =
            /language-([\w-]+)/.exec(child.props.className ?? "")?.[1] ??
            "text";
          const value = String(child.props.children ?? "").replace(/\n$/, "");
          return (
            <section
              className="code-block"
              aria-label={t("messages.codeBlock", { language })}
            >
              <div className="code-block-header">
                <span>{language}</span>
                <CopyButton text={value} label={t("messages.copyCode")} />
              </div>
              <section
                className="code-block-scroll"
                aria-label={t("messages.codeBlock", { language })}
                // biome-ignore lint/a11y/noNoninteractiveTabindex: Code and table output regions need keyboard scrolling.
                tabIndex={0}
              >
                <HighlightedCode language={language} value={value} />
              </section>
            </section>
          );
        },
        code({ children: codeChildren }) {
          return <code>{codeChildren}</code>;
        },
        table({ children: tableChildren }) {
          return (
            <section
              className="markdown-table"
              aria-label={t("messages.table")}
              // biome-ignore lint/a11y/noNoninteractiveTabindex: Wide table output needs keyboard scrolling.
              tabIndex={0}
            >
              <table>{tableChildren}</table>
            </section>
          );
        },
        a({ href, children: linkChildren }) {
          return (
            <a
              href={href}
              title={href}
              onClick={(event) => {
                event.preventDefault();
                if (href && event.isTrusted)
                  void window.forgeDesktop
                    ?.openSource(href)
                    .catch(() => undefined);
              }}
            >
              {linkChildren}
            </a>
          );
        },
      }}
    >
      {children}
    </ReactMarkdown>
  );
});
