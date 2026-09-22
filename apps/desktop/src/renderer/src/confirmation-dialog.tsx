import { type ReactNode, useEffect, useRef } from "react";

/** Native modal semantics contain keyboard focus and make the background inert. */
export function ConfirmationDialog({
  title,
  children,
  confirmLabel,
  cancelLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const opener = document.activeElement;
    const element = dialog.current;
    element?.showModal();
    cancel.current?.focus();
    return () => {
      element?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="studio-confirmation"
      aria-labelledby="confirmation-title"
      aria-describedby="confirmation-body"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h3 id="confirmation-title">{title}</h3>
      <div id="confirmation-body">{children}</div>
      <div className="studio-confirmation-actions">
        <button ref={cancel} type="button" disabled={busy} onClick={onCancel}>
          {cancelLabel}
        </button>
        <button type="button" disabled={busy} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
