import {
  createOpenResponses,
  type OpenResponsesLanguageModelOptions,
  type OpenResponsesProviderSettings,
} from "@ai-sdk/open-responses";
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

import type { MiMoTransport, MiMoTransportRequest } from "./transport.js";

type StreamTextFunction = typeof streamText;

export class AiSdkMiMoTransport implements MiMoTransport {
  readonly #streamText: StreamTextFunction;
  readonly #fetch: OpenResponsesProviderSettings["fetch"];

  constructor(
    options:
      | StreamTextFunction
      | {
          readonly streamTextFunction?: StreamTextFunction;
          readonly fetch?: OpenResponsesProviderSettings["fetch"];
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
    request: MiMoTransportRequest,
    signal: AbortSignal,
  ): AsyncIterable<ModelStreamEvent> {
    const mimo = createOpenResponses({
      name: "mimo",
      url: responsesURL(request.baseURL),
      apiKey: request.apiKey,
      ...(this.#fetch ? { fetch: this.#fetch } : {}),
    });
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
        model: mimo(request.model),
        messages,
        abortSignal: signal,
        onError: () => undefined,
        ...(request.tools?.length
          ? { tools: toAiSdkTools(request.tools) }
          : {}),
        providerOptions: {
          mimo: {
            reasoningEffort: request.reasoningEffort,
          } satisfies OpenResponsesLanguageModelOptions,
        },
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
            throw mapMiMoError(part.error);
          default:
            break;
        }
      }

      if (finish) {
        const responseMessages = await result.responseMessages;
        yield {
          type: "finish",
          finishReason: finish.finishReason,
          usage: normalizeUsage(finish.usage),
          ...(metadata ? { providerMetadata: metadata } : {}),
          continuation: {
            provider: "mimo",
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
      throw mapMiMoError(error);
    }
  }
}

export function responsesURL(baseURL: string): string {
  const normalized = baseURL.trim().replace(/\/+$/u, "");
  return normalized.endsWith("/responses")
    ? normalized
    : `${normalized}/responses`;
}

function buildMessages(request: MiMoTransportRequest): ModelMessage[] {
  let messages: ModelMessage[];
  if (request.continuation) {
    const data = request.continuation.data;
    if (
      request.continuation.provider !== "mimo" ||
      typeof data !== "object" ||
      data === null ||
      !("messages" in data) ||
      !Array.isArray(data.messages)
    ) {
      throw new ModelProviderError(
        "MiMo received incompatible continuation data.",
        { provider: "mimo", retryable: false },
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
  if (
    typeof warning === "object" &&
    warning !== null &&
    "message" in warning &&
    typeof warning.message === "string"
  ) {
    return warning.message;
  }
  return "MiMo returned an unrecognized provider warning.";
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

export function mapMiMoError(error: unknown): ModelProviderError {
  if (error instanceof ModelProviderError) return error;
  const apiError = unwrapApiCallError(error);
  const statusCode = apiError?.statusCode;
  if (statusCode === 401 || statusCode === 403) {
    return new ModelProviderError(
      "MiMo rejected the API key. Check MIMO_API_KEY.",
      { provider: "mimo", statusCode, retryable: false, cause: error },
    );
  }
  if (statusCode === 429) {
    return new ModelProviderError(
      "MiMo rate or quota limit reached. Check the account quota and retry later.",
      { provider: "mimo", statusCode, retryable: true, cause: error },
    );
  }
  if (statusCode !== undefined && statusCode >= 500) {
    return new ModelProviderError("MiMo is temporarily unavailable.", {
      provider: "mimo",
      statusCode,
      retryable: true,
      cause: error,
    });
  }
  if (statusCode !== undefined) {
    return new ModelProviderError(
      `MiMo request failed with HTTP ${statusCode}.`,
      { provider: "mimo", statusCode, retryable: false, cause: error },
    );
  }
  return new ModelProviderError(
    "Could not complete the MiMo request. Check the network and model configuration.",
    { provider: "mimo", retryable: true, cause: error },
  );
}

function unwrapApiCallError(error: unknown): APICallError | undefined {
  if (APICallError.isInstance(error)) return error;
  if (RetryError.isInstance(error)) return unwrapApiCallError(error.lastError);
  if (typeof error === "object" && error !== null && "cause" in error) {
    return unwrapApiCallError(error.cause);
  }
  return undefined;
}
