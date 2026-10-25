import { memo } from "react";
import { useTranslation } from "react-i18next";
import markUrl from "./assets/forge-mark.svg";
import { CopyButton } from "./copy-button.js";
import { Markdown } from "./markdown.js";

export const ConversationMessage = memo(function ConversationMessage({
  author,
  content,
  streaming = false,
}: {
  author: "user" | "assistant";
  content: string;
  streaming?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <article
      className={author === "user" ? "live-user" : "live-answer"}
      aria-label={t(author === "user" ? "messages.user" : "messages.assistant")}
      aria-busy={streaming || undefined}
    >
      {author === "assistant" && (
        <img
          className="studio-answer-avatar"
          src={markUrl}
          alt=""
          aria-hidden="true"
        />
      )}
      <Markdown>{content}</Markdown>
      {author === "assistant" && (
        <div className="message-actions">
          <CopyButton text={content} label={t("messages.copyAnswer")} />
        </div>
      )}
    </article>
  );
});
