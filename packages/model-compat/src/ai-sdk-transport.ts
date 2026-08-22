import { createOpenAI, type OpenAIProviderSettings } from "@ai-sdk/openai";
import {
  type ModelFinishReason,
  ModelProviderError,
  type ModelStreamEvent,
  type ModelToolDefinition,
  type ModelUsage,
} from "@forge/core";
import {
  APICallError,
  type LanguageModelUsage,
  type ModelMessage,
  RetryError,
  streamText,
  type ToolSet,
  tool,
} from "ai";

import type { CompatTransport, CompatTransportRequest } from "./transport.js";

type StreamTextFunction = typeof streamText;

export class AiSdkCompatTransport implements CompatTransport {
  readonly #streamText: StreamTextFunction;
  readonly #fetch: OpenAIProviderSettings["fetch"];

  constructor(
    options:
      | StreamTextFunction
      | {
          readonly streamTextFunction?: StreamTextFunction;
          readonly fetch?: OpenAIProviderSettings["fetch"];
        } = {},
  ) {
    if (typeof options === "function") {
      this.#streamText = options;
      this.#fetch = undefined;
    } else {
      this.#streamText = options.streamTextFunction ?? streamText;
      this.#fetch = options.fetch;
    }
  }

  async *stream(
    request: CompatTransportRequest,
    signal: AbortSignal,
  ): AsyncIterable<ModelStreamEvent> {
    const provider = createOpenAI({
      apiKey: request.apiKey ?? "",
      baseURL: request.baseUrl,
      name: request.route,
      ...(request.apiKey === undefined
        ? { fetch: unauthenticatedFetch(this.#fetch) }
        : this.#fetch
          ? { fetch: this.#fetch }
          : {}),
    });
    const model =
      request.api === "openai-responses"
        ? provider.responses(request.model)
        : provider.chat(request.model);
    let metadata: Readonly<Record<string, unknown>> | undefined;
    let finish:
      | {
          readonly finishReason: ModelFinishReason;
          readonly usage: LanguageModelUsage;
        }
      | undefined;

    try {
      const messages = buildMessages(request);
      const result = this.#streamText({
        model,
        messages,
        abortSignal: signal,
        onError: () => undefined,
        ...(request.tools?.length
          ? { tools: toAiSdkTools(request.tools) }
          : {}),
        ...(request.reasoningEffort !== undefined
          ? {
              providerOptions: {
                openai: {
                  // Compatibility routes cannot assume server-side response
                  // storage. Stateless replay keeps continuation owned by the
                  // adapter and retains reasoning provider metadata when the
                  // endpoint returns it.
                  ...(request.api === "openai-responses" &&
                  request.reasoningEffort !== "none"
                    ? { store: false }
                    : {}),
                  ...(request.reasoningEffort === undefined
                    ? {}
                    : {
                        reasoningEffort: request.reasoningEffort,
                        // OpenAI's SDK capability table only recognizes OpenAI
                        // model ids. Explicit reasoningGears opt a custom model
                        // into the reasoning request shape.
                        forceReasoning: true,
                      }),
                },
              },
            }
          : {}),
      });

      for await (const part of result.stream) {
        switch (part.type) {
          case "reasoning-delta":
            yield { type: "reasoning.delta", text: part.text };
            break;
          case "text-delta":
            yield { type: "text.delta", text: part.text };
            break;
          case "tool-call":
            yield {
              type: "tool.call",
              call: {
                id: part.toolCallId,
                name: part.toolName,
                input: part.input,
                ...(part.providerMetadata
                  ? { providerMetadata: part.providerMetadata }
                  : {}),
              },
            };
            break;
          case "start-step":
            for (const warning of part.warnings) {
              yield { type: "warning", message: describeWarning(warning) };
            }
            break;
          case "finish-step":
            metadata = part.providerMetadata;
            break;
          case "finish":
            finish = {
              finishReason: part.finishReason,
              usage: part.totalUsage,
            };
            break;
          case "abort":
            yield {
              type: "abort",
              ...(part.reason ? { reason: part.reason } : {}),
            };
            return;
          case "error":
            throw mapCompatError(part.error, request.route);
          default:
            break;
        }
      }

      if (finish) {
        const responseMessages = await result.responseMessages;
        if (
          finish.finishReason === "tool-calls" &&
          (finish.usage.outputTokenDetails.reasoningTokens ?? 0) > 0 &&
          !hasReplayableReasoning(responseMessages)
        ) {
          yield {
            type: "warning",
            message:
              "The provider used reasoning before a tool call but returned no replayable reasoning content. Its next continuation request may be rejected; disable reasoning or use a protocol that preserves provider reasoning state.",
          };
        }
        yield {
          type: "finish",
          finishReason: finish.finishReason,
          usage: normalizeUsage(finish.usage),
          ...(metadata ? { providerMetadata: metadata } : {}),
          continuation: {
            provider: request.route,
            data: {
              messages: [
                ...messages,
                ...responseMessages.filter(
                  (message) => message.role !== "tool",
                ),
              ],
            },
          },
        };
      }
    } catch (error) {
      if (signal.aborted || isAbortError(error)) {
        yield {
          type: "abort",
          ...(typeof signal.reason === "string"
            ? { reason: signal.reason }
            : {}),
        };
        return;
      }
      throw mapCompatError(error, request.route);
    }
  }
}

function hasReplayableReasoning(messages: readonly ModelMessage[]): boolean {
  return messages.some((message) => {
    if (message.role !== "assistant" || !Array.isArray(message.content)) {
      return false;
    }
    return message.content.some((part) => {
      if (
        typeof part !== "object" ||
        part === null ||
        !("type" in part) ||
        part.type !== "reasoning"
      ) {
        return false;
      }
      const text =
        "text" in part && typeof part.text === "string" ? part.text : "";
      return (
        text.trim() !== "" ||
        ("providerOptions" in part && part.providerOptions !== undefined) ||
        ("providerMetadata" in part && part.providerMetadata !== undefined)
      );
    });
  });
}

function unauthenticatedFetch(
  fetchImplementation: OpenAIProviderSettings["fetch"],
): NonNullable<OpenAIProviderSettings["fetch"]> {
  const nextFetch = (fetchImplementation ?? globalThis.fetch) as NonNullable<
    OpenAIProviderSettings["fetch"]
  >;
  return (input, init) => {
    const headers = new Headers(init?.headers);
    headers.delete("authorization");
    return nextFetch(input, { ...init, headers });
  };
}

function buildMessages(request: CompatTransportRequest): ModelMessage[] {
  let messages: ModelMessage[];
  if (request.continuation) {
    const data = request.continuation.data;
    if (
      request.continuation.provider !== request.route ||
      typeof data !== "object" ||
      data === null ||
      !("messages" in data) ||
      !Array.isArray(data.messages)
    ) {
      throw new ModelProviderError(
        `Provider route "${request.route}" received incompatible continuation data.`,
        { provider: request.route, retryable: false },
      );
    }
    messages = [...data.messages] as ModelMessage[];
  } else {
    messages = [
      ...(request.instructions
        ? [{ role: "system" as const, content: request.instructions }]
        : []),
      ...(request.conversation ?? []),
      {
        role: "user",
        content: request.images?.length
          ? [
              { type: "text" as const, text: request.prompt },
              ...request.images.map(toAiSdkImagePart),
            ]
          : request.prompt,
      },
    ];
  }
  if (request.toolResults?.length) {
    messages.push({
      role: "tool",
      content: request.toolResults.map((result) => ({
        type: "tool-result" as const,
        toolCallId: result.callId,
        toolName: result.toolName,
        output: { type: "text" as const, value: JSON.stringify(result.result) },
      })),
    });
  }
  return messages;
}

function toAiSdkImagePart(
  image: import("@forge/core").ModelImageInput,
): import("ai").FilePart {
  if (image.type === "url") {
    return {
      type: "file",
      mediaType: "image",
      data: { type: "url", url: new URL(image.url) },
    };
  }
  return {
    type: "file",
    mediaType: image.mediaType,
    data: { type: "data", data: image.data },
    ...(image.filename ? { filename: image.filename } : {}),
  };
}

function toAiSdkTools(definitions: readonly ModelToolDefinition[]): ToolSet {
  return Object.fromEntries(
    definitions.map((definition) => [
      definition.name,
      tool({
        description: definition.description,
        inputSchema: definition.inputSchema,
      }),
    ]),
  );
}

function normalizeUsage(usage: LanguageModelUsage): ModelUsage {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    reasoningTokens: usage.outputTokenDetails.reasoningTokens,
    cachedInputTokens: usage.inputTokenDetails.cacheReadTokens,
    cacheWriteTokens: usage.inputTokenDetails.cacheWriteTokens,
    totalTokens: usage.totalTokens,
  };
}

function describeWarning(warning: unknown): string {
  if (typeof warning !== "object" || warning === null) {
    return "The provider returned an unrecognized warning.";
  }
  if ("message" in warning && typeof warning.message === "string") {
    return warning.message;
  }
  const feature =
    "feature" in warning && typeof warning.feature === "string"
      ? warning.feature
      : "provider feature";
  if ("details" in warning && typeof warning.details === "string") {
    return `${feature}: ${warning.details}`;
  }
  if ("type" in warning && typeof warning.type === "string") {
    return `${feature}: ${warning.type}`;
  }
  return "The provider returned an unrecognized warning.";
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

export function mapCompatError(
  error: unknown,
  route: string,
): ModelProviderError {
  if (error instanceof ModelProviderError) return error;
  const apiError = unwrapApiCallError(error);
  const statusCode = apiError?.statusCode;
  if (statusCode === 401 || statusCode === 403) {
    return new ModelProviderError(
      `Provider route "${route}" rejected its credential.`,
      { provider: route, statusCode, retryable: false, cause: error },
    );
  }
  if (statusCode === 404) {
    return new ModelProviderError(
      `Provider route "${route}" answered HTTP 404. Check its baseUrl and model id.`,
      { provider: route, statusCode, retryable: false, cause: error },
    );
  }
  if (statusCode === 429) {
    return new ModelProviderError(
      `Provider route "${route}" reported a rate or quota limit.`,
      { provider: route, statusCode, retryable: true, cause: error },
    );
  }
  if (statusCode !== undefined) {
    const detail = safeApiErrorDetail(apiError);
    return new ModelProviderError(
      `Provider route "${route}" request failed with HTTP ${statusCode}${detail ? `: ${detail}` : ""}.`,
      {
        provider: route,
        statusCode,
        retryable: statusCode >= 500 || apiError?.isRetryable === true,
        cause: error,
      },
    );
  }
  return new ModelProviderError(
    `Could not reach provider route "${route}". Check its endpoint and network configuration.`,
    { provider: route, retryable: true, cause: error },
  );
}

function safeApiErrorDetail(
  error: APICallError | undefined,
): string | undefined {
  if (!error?.responseBody) return undefined;
  let body: unknown;
  try {
    body = JSON.parse(error.responseBody);
  } catch {
    return undefined;
  }
  const nested = property(body, "error");
  const code = textDetail(property(nested, "code") ?? property(body, "code"));
  const message = textDetail(
    property(nested, "message") ?? property(body, "message"),
  );
  const combined = [code, message].filter(Boolean).join(": ");
  if (combined === "") return undefined;
  return combined
    .replace(/\b(?:sk|tp)-[A-Za-z0-9._-]{6,}\b/gu, "[redacted]")
    .replace(/\bBearer\s+[^\s"',}]+/giu, "Bearer [redacted]")
    .replace(
      /\b(api[_ -]?key|authorization|token)\s*[:=]\s*["']?[^\s"',}]+/giu,
      "$1=[redacted]",
    )
    .slice(0, 300)
    .replace(/[.:;,\s]+$/u, "");
}

function property(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && key in value
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function textDetail(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const withoutControls = Array.from(String(value), (character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f ? " " : character;
  }).join("");
  const text = withoutControls.replace(/\s+/gu, " ").trim();
  return text === "" ? undefined : text;
}

function unwrapApiCallError(error: unknown): APICallError | undefined {
  if (APICallError.isInstance(error)) return error;
  if (RetryError.isInstance(error)) return unwrapApiCallError(error.lastError);
  if (typeof error === "object" && error !== null && "cause" in error) {
    return unwrapApiCallError(error.cause);
  }
  return undefined;
}
