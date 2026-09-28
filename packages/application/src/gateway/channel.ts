export interface ChannelEvent {
  readonly channel: string;
  readonly accountId: string;
  readonly eventId: string;
  readonly senderId: string;
  readonly conversationId: string;
  readonly threadId?: string;
  readonly receivedAt: number;
  readonly kind: "text" | "approval" | "unsupported";
  readonly text: string;
  readonly private: boolean;
}
export interface ChannelMessage {
  readonly conversationId: string;
  readonly text: string;
  readonly buttons?:
    | readonly { readonly label: string; readonly data: string }[]
    | undefined;
}
export interface ChannelAdapter {
  readonly channel: string;
  readonly accountId: string;
  readonly capabilities: {
    readonly buttons: boolean;
    readonly edit: boolean;
    readonly textLimit: number;
  };
  send(message: ChannelMessage, signal: AbortSignal): Promise<void>;
}
export class ChannelError extends Error {
  constructor(
    readonly fatal: boolean,
    readonly retryAfterMs = 1000,
  ) {
    super(
      fatal
        ? "channel-auth-or-request-failed"
        : "channel-temporarily-unavailable",
    );
  }
}
export function boundedText(text: string, bytes: number): string {
  let size = 0;
  let result = "";
  for (const char of text) {
    size += Buffer.byteLength(char);
    if (size > bytes) break;
    result += char;
  }
  return result;
}
