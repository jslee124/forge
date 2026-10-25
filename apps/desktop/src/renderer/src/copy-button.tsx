import { Copy } from "@phosphor-icons/react/Copy";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export function CopyButton({ text, label }: { text: string; label: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState<string>();
  const [failed, setFailed] = useState<string>();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  const copy = async () => {
    const captured = text;
    try {
      if (!navigator.clipboard) throw new Error("clipboard-unavailable");
      await navigator.clipboard.writeText(captured);
      if (!mounted.current) return;
      setFailed(undefined);
      setCopied(captured);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(undefined), 1600);
    } catch {
      if (mounted.current) {
        if (timer.current) clearTimeout(timer.current);
        setCopied(undefined);
        setFailed(captured);
      }
    }
  };
  return (
    <span className="copy-control">
      <button
        type="button"
        className="copy-button"
        aria-label={label}
        title={label}
        onClick={() => void copy()}
      >
        <Copy size={14} aria-hidden="true" />
        {copied === text ? t("messages.copied") : label}
      </button>
      <span
        className="copy-feedback"
        data-error={failed === text}
        role="status"
        aria-live="polite"
      >
        {failed === text
          ? t("messages.copyFailed")
          : copied === text
            ? t("messages.copied")
            : ""}
      </span>
    </span>
  );
}
