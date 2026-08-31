export type InteractivePhase =
  | "editing"
  | "running"
  | "approving"
  | "approval-feedback"
  | "resuming"
  | "models"
  | "delete-models"
  | "delete-model-confirm"
  | "effort"
  | "plugins"
  | "resources"
  | "permissions"
  | "plugin-trust"
  | "login-providers"
  | "login-key"
  | "logout-providers"
  | "provider-actions"
  | "provider-remove-confirm"
  | "provider-setup";

export type TranscriptKind =
  | "user"
  | "reasoning"
  | "answer"
  | "tool"
  | "warning"
  | "error"
  | "system"
  | "diff"
  | "raw";

export interface TranscriptEntry {
  readonly id: number;
  readonly kind: TranscriptKind;
  readonly text: string;
}

export type RunActivity =
  | { readonly kind: "thinking"; readonly step?: number }
  | {
      readonly kind: "tool";
      readonly stage: "preparing" | "executing";
      readonly toolName: string;
      readonly target?: string;
      readonly operation?: "create" | "replace" | "rewrite";
    };

export interface PendingSignIn {
  readonly url: string;
  readonly userCode?: string;
}
