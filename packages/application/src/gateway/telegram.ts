import {
  type ChannelAdapter,
  ChannelError,
  type ChannelEvent,
  type ChannelMessage,
} from "./channel.js";

type RecordValue = Partial<
  Record<
    | "audio"
    | "buttons"
    | "callback_query"
    | "chat"
    | "conversationId"
    | "data"
    | "date"
    | "document"
    | "edited_message"
    | "error_code"
    | "forward_date"
    | "forward_origin"
    | "from"
    | "id"
    | "is_bot"
    | "message"
    | "message_thread_id"
    | "ok"
    | "parameters"
    | "photo"
    | "result"
    | "retry_after"
    | "sticker"
    | "text"
    | "type"
    | "update_id"
    | "url"
    | "via_bot"
    | "video"
    | "voice",
    unknown
  >
>;
function object(value: unknown): RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
}
function id(value: unknown): string {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? String(value)
    : "";
}

export function telegramEvent(
  raw: unknown,
  accountId: string,
): ChannelEvent | undefined {
  const update = object(raw);
  if (!id(update.update_id)) return undefined;
  const callback = object(update.callback_query);
  const isCallback = typeof callback.id === "string";
  const message = object(
    isCallback ? callback.message : (update.message ?? update.edited_message),
  );
  const sender = object(isCallback ? callback.from : message.from);
  const chat = object(message.chat);
  const privateChat =
    chat.type === "private" &&
    sender.is_bot === false &&
    id(chat.id) === id(sender.id);
  const unsupported =
    !isCallback &&
    (update.edited_message !== undefined ||
      message.forward_origin !== undefined ||
      message.forward_date !== undefined ||
      message.via_bot !== undefined ||
      message.photo !== undefined ||
      message.document !== undefined ||
      message.voice !== undefined ||
      message.video !== undefined ||
      message.audio !== undefined ||
      message.sticker !== undefined ||
      typeof message.text !== "string");
  if (!id(sender.id) || !id(chat.id)) return undefined;
  return {
    channel: "telegram",
    accountId,
    eventId: String(update.update_id),
    senderId: id(sender.id),
    conversationId: id(chat.id),
    ...(message.message_thread_id !== undefined
      ? { threadId: id(message.message_thread_id) }
      : {}),
    receivedAt: isCallback
      ? Date.now()
      : typeof message.date === "number"
        ? message.date * 1000
        : 0,
    private: privateChat,
    kind: isCallback ? "approval" : unsupported ? "unsupported" : "text",
    text: String(isCallback ? (callback.data ?? "") : (message.text ?? "")),
  };
}

export class TelegramAdapter implements ChannelAdapter {
  readonly channel = "telegram";
  readonly capabilities = { buttons: true, edit: false, textLimit: 3500 };
  constructor(
    readonly accountId: string,
    private readonly token: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    if (
      !/^\d+:[A-Za-z0-9_-]+$/u.test(token) ||
      token.split(":")[0] !== accountId
    )
      throw new Error("telegram-account-mismatch");
  }
  async call(
    method: string,
    payload: unknown,
    signal: AbortSignal,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetcher(
        `https://api.telegram.org/bot${this.token}/${method}`,
        {
          method: "POST",
          redirect: "error",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.any([signal, AbortSignal.timeout(35000)]),
        },
      );
    } catch {
      throw new ChannelError(false);
    }
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    const reader = response.body?.getReader();
    if (!reader) throw new ChannelError(false);
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 2 * 1024 * 1024) {
          await reader.cancel();
          throw new ChannelError(true);
        }
        chunks.push(value);
      }
    } catch (error) {
      if (error instanceof ChannelError) throw error;
      throw new ChannelError(false);
    }
    let body: RecordValue;
    try {
      body = object(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    } catch {
      throw new ChannelError(false);
    }
    if (!response.ok || body.ok !== true) {
      const code =
        typeof body.error_code === "number" ? body.error_code : response.status;
      const retry = object(body.parameters).retry_after;
      throw new ChannelError(
        code >= 400 && code < 500 && code !== 429,
        typeof retry === "number" ? Math.max(1000, retry * 1000) : 1000,
      );
    }
    return body.result;
  }
  async verify(signal: AbortSignal): Promise<void> {
    const me = object(await this.call("getMe", {}, signal));
    if (id(me.id) !== this.accountId || me.is_bot !== true)
      throw new ChannelError(true);
    const webhook = object(await this.call("getWebhookInfo", {}, signal));
    if (webhook.url !== "")
      throw new Error(
        "Telegram webhook configured; remove it locally before starting polling.",
      );
  }
  async poll(
    offset: number,
    signal: AbortSignal,
  ): Promise<
    readonly { offset: number; event?: ChannelEvent; callbackId?: string }[]
  > {
    const result = await this.call(
      "getUpdates",
      {
        offset,
        timeout: 25,
        limit: 100,
        allowed_updates: ["message", "edited_message", "callback_query"],
      },
      signal,
    );
    if (!Array.isArray(result) || result.length > 100)
      throw new ChannelError(false);
    return result.map((raw: unknown) => {
      const update = object(raw);
      if (
        !Number.isSafeInteger(update.update_id) ||
        Number(update.update_id) < 0
      )
        throw new ChannelError(true);
      const event = telegramEvent(raw, this.accountId);
      const callbackId = object(update.callback_query).id;
      return {
        offset: Number(update.update_id) + 1,
        ...(event ? { event } : {}),
        ...(typeof callbackId === "string" ? { callbackId } : {}),
      };
    });
  }
  async send(message: ChannelMessage, signal: AbortSignal): Promise<void> {
    await this.call(
      "sendMessage",
      {
        chat_id: message.conversationId,
        text: message.text,
        link_preview_options: { is_disabled: true },
        ...(message.buttons
          ? {
              reply_markup: {
                inline_keyboard: [
                  message.buttons.map((button) => ({
                    text: button.label,
                    callback_data: button.data,
                  })),
                ],
              },
            }
          : {}),
      },
      signal,
    );
  }
  async answerCallback(callbackId: string, signal: AbortSignal): Promise<void> {
    await this.call(
      "answerCallbackQuery",
      { callback_query_id: callbackId },
      signal,
    );
  }
}
