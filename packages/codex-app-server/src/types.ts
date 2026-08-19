export type JsonRpcId = number | string;

export interface JsonRpcNotification<T = unknown> {
  readonly method: string;
  readonly params: T;
}

export interface JsonRpcServerRequest<T = unknown> {
  readonly id: JsonRpcId;
  readonly method: string;
  readonly params: T;
}

export type CodexLoginMethod = "browser" | "device-code";

export type CodexLoginResponse =
  | {
      readonly type: "chatgpt";
      readonly loginId: string;
      readonly authUrl: string;
    }
  | {
      readonly type: "chatgptDeviceCode";
      readonly loginId: string;
      readonly verificationUrl: string;
      readonly userCode: string;
    };

export interface CodexLoginCompleted {
  readonly loginId: string | null;
  readonly success: boolean;
  readonly error: string | null;
}

export type CodexAccount =
  | { readonly type: "apiKey" }
  | {
      readonly type: "chatgpt";
      readonly email: string | null;
      readonly planType: string;
    }
  | {
      readonly type: "amazonBedrock";
      readonly usesCodexManagedCredentials: boolean;
    };

export interface CodexAccountResponse {
  readonly account: CodexAccount | null;
  readonly requiresOpenaiAuth: boolean;
}

export interface CodexReasoningEffort {
  readonly reasoningEffort: string;
  readonly description: string;
}

export interface CodexModel {
  readonly id: string;
  readonly model: string;
  readonly displayName: string;
  readonly description: string;
  readonly hidden: boolean;
  readonly supportedReasoningEfforts: readonly CodexReasoningEffort[];
  readonly defaultReasoningEffort: string;
  readonly inputModalities: readonly string[];
  readonly isDefault: boolean;
}

export interface CodexModelListResponse {
  readonly data: readonly CodexModel[];
  readonly nextCursor: string | null;
}

export interface CodexThreadStartResponse {
  readonly thread: { readonly id: string };
  readonly model: string;
  readonly modelProvider: string;
  readonly reasoningEffort: string | null;
}

export interface CodexTurnStartResponse {
  readonly turn: { readonly id: string; readonly status: string };
}

export interface CodexTurnCompleted {
  readonly threadId: string;
  readonly turn: {
    readonly id: string;
    readonly status: "completed" | "interrupted" | "failed" | "inProgress";
    readonly error: { readonly message: string } | null;
  };
}
