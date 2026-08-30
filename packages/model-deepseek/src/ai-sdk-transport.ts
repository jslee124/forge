import {
  createDeepSeek,
  type DeepSeekLanguageModelChatOptions,
  type DeepSeekProviderSettings,
} from "@ai-sdk/deepseek";
import {
  createOpenAI,
  type OpenAIProviderSettings,
  type OpenAIResponsesProviderOptions,
} from "@ai-sdk/openai";
import {
  type ModelFinishReason,
  ModelProviderError,
  type ModelStreamEvent,
  type ModelToolDefinition,
  type ModelUsage,
  projectCanonicalConversation,
} from "@forge/core";
import {
  APICallError,
  InvalidPromptError,
  type LanguageModelUsage,
  type ModelMessage,
  RetryError,
  streamText,
  type ToolSet,
  tool,
} from "ai";
import type { DeepSeekReasoningEffort } from "./config.js";
import type {
  DeepSeekTransport,
  DeepSeekTransportRequest,
} from "./transport.js";

type StreamTextFunction = typeof streamText;

export class AiSdkDeepSeekTransport implements DeepSeekTransport {
  readonly #streamText: StreamTextFunction;
  readonly #fetch: DeepSeekProviderSettings["fetch"];

  constructor(
    options:
      | StreamTextFunction
      | {
          readonly streamTextFunction?: StreamTextFunction;
          readonly fetch?: DeepSeekProviderSettings["fetch"] &
            OpenAIProviderSettings["fetch"];
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
    request: DeepSeekTransportRequest,
    signal: AbortSignal,
  ): AsyncIterable<ModelStreamEvent> {
    const deepSeek = createDeepSeek({
      apiKey: request.apiKey,
      ...(this.#fetch ? { fetch: this.#fetch } : {}),
    });
    const responses = createOpenAI({
      apiKey: request.apiKey,
      baseURL: "https://api.deepseek.com",
      fetch: createDeepSeekResponsesFetch(
        this.#fetch,
        request.thinking === "disabled"
          ? "none"
          : (request.reasoningEffort ?? "high"),
      ),
    });
    const usesResponsesApi = request.model === "deepseek-v4-flash-vision-exp";
    let providerMetadata: Readonly<Record<string, unknown>> | undefined;
    let finishPart:
      | {
          readonly finishReason: ModelFinishReason;
          readonly totalUsage: LanguageModelUsage;
        }
      | undefined;

    try {
      const messages = buildMessages(request);
      const result = this.#streamText({
        model: usesResponsesApi
          ? responses.responses(request.model)
          : deepSeek(request.model),
        ...(request.instructions ? { instructions: request.instructions } : {}),
        messages,
        abortSignal: signal,
        // Forge maps stream errors itself. The AI SDK default logs the raw
        // error (including a stack trace) before Forge can render it safely.
        onError: () => undefined,
        ...(request.tools && request.tools.length > 0
          ? { tools: toAiSdkTools(request.tools) }
          : {}),
        providerOptions: usesResponsesApi
          ? {
              openai: {
                store: false,
              } satisfies OpenAIResponsesProviderOptions,
            }
          : {
              deepseek: {
                thinking: { type: request.thinking },
                ...(request.thinking === "enabled"
                  ? {
                      reasoningEffort: toChatReasoningEffort(
                        request.reasoningEffort ?? "high",
                      ),
                    }
                  : {}),
              } satisfies DeepSeekLanguageModelChatOptions,
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
            providerMetadata = part.providerMetadata;
            break;

          case "finish": {
            finishPart = {
              finishReason: part.finishReason,
              totalUsage: part.totalUsage,
            };
            break;
          }

          case "abort":
            yield {
              type: "abort",
              ...(part.reason ? { reason: part.reason } : {}),
            };
            return;

          case "error":
            throw mapDeepSeekError(part.error);

          default:
            break;
        }
      }

      if (finishPart) {
        const responseMessages = await result.responseMessages;
        // Invalid schema input makes the AI SDK synthesize a tool-error
        // message even though Forge intentionally owns validation and tool
        // execution. Keep the assistant tool call, but let the runtime append
        // the single canonical Forge tool result on the next model step.
        const forgeContinuationMessages = responseMessages.filter(
          (message) => message.role !== "tool",
        );
        yield {
          type: "finish",
          finishReason: finishPart.finishReason,
          usage: normalizeUsage(finishPart.totalUsage),
          ...(providerMetadata ? { providerMetadata } : {}),
          continuation: {
            provider: "deepseek",
            data: { messages: [...messages, ...forgeContinuationMessages] },
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

      throw mapDeepSeekError(error);
    }
  }
}

function toChatReasoningEffort(
  effort: DeepSeekReasoningEffort,
): "low" | "medium" | "high" | "xhigh" | "max" {
  return effort === "none" || effort === "minimal" ? "low" : effort;
}

function createDeepSeekResponsesFetch(
  fetchImplementation: OpenAIProviderSettings["fetch"],
  reasoningEffort: DeepSeekReasoningEffort,
): NonNullable<OpenAIProviderSettings["fetch"]> {
  const nextFetch = (fetchImplementation ?? globalThis.fetch) as NonNullable<
    OpenAIProviderSettings["fetch"]
  >;
  return async (input, init) => {
    if (typeof init?.body !== "string") {
      return nextFetch(input, init);
    }
    try {
      const body = JSON.parse(init.body) as Record<string, unknown>;
      return nextFetch(input, {
        ...init,
        body: JSON.stringify({
          ...body,
          // The OpenAI provider does not classify DeepSeek's custom vision
          // model as a reasoning model, so it will not request a summary for
          // us. Without one, usage includes reasoning tokens but the stream
          // contains no reasoning deltas for Forge to render.
          reasoning: {
            effort: reasoningEffort,
            ...(reasoningEffort === "none" ? {} : { summary: "detailed" }),
          },
          store: false,
        }),
      });
    } catch {
      return nextFetch(input, init);
    }
  };
}

interface DeepSeekContinuationData {
  readonly messages: readonly ModelMessage[];
}

function buildMessages(request: DeepSeekTransportRequest): ModelMessage[] {
  let messages: ModelMessage[];

  if (request.continuation) {
    if (
      request.continuation.provider !== "deepseek" ||
      !isDeepSeekContinuationData(request.continuation.data)
    ) {
      throw new ModelProviderError(
        "DeepSeek received incompatible continuation data.",
        { provider: "deepseek", retryable: false },
      );
    }
    messages = [...request.continuation.data.messages];
  } else {
    messages = [
      ...(projectCanonicalConversation(
        request.conversation ?? [],
      ) as ModelMessage[]),
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

  if (request.toolResults && request.toolResults.length > 0) {
    messages.push({
      role: "tool",
      content: request.toolResults.map((toolResult) => ({
        type: "tool-result" as const,
        toolCallId: toolResult.callId,
        toolName: toolResult.toolName,
        output: {
          type: "text" as const,
          value: JSON.stringify(toolResult.result),
        },
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

function isDeepSeekContinuationData(
  value: unknown,
): value is DeepSeekContinuationData {
  return (
    typeof value === "object" &&
    value !== null &&
    "messages" in value &&
    Array.isArray(value.messages)
  );
}

export function toAiSdkTools(
  definitions: readonly ModelToolDefinition[],
): ToolSet {
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

  try {
    return JSON.stringify(warning);
  } catch {
    return "DeepSeek returned an unrecognized provider warning.";
  }
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

export function mapDeepSeekError(error: unknown): ModelProviderError {
  if (error instanceof ModelProviderError) {
    return error;
  }

  if (InvalidPromptError.isInstance(error)) {
    return new ModelProviderError(
      "Could not construct the DeepSeek request. Check the prompt and model configuration.",
      {
        provider: "deepseek",
        retryable: false,
        cause: error,
      },
    );
  }

  const apiError = unwrapApiCallError(error);
  const statusCode = apiError?.statusCode;

  if (statusCode === 401 || statusCode === 403) {
    return new ModelProviderError(
      "DeepSeek rejected the API key. Check DEEPSEEK_API_KEY.",
      {
        provider: "deepseek",
        statusCode,
        retryable: false,
        cause: error,
      },
    );
  }

  if (statusCode === 429) {
    return new ModelProviderError(
      "DeepSeek rate limit reached. Try again later.",
      {
        provider: "deepseek",
        statusCode,
        retryable: true,
        cause: error,
      },
    );
  }

  if (statusCode !== undefined && statusCode >= 500) {
    return new ModelProviderError(
      "DeepSeek is temporarily unavailable. Try again later.",
      {
        provider: "deepseek",
        statusCode,
        retryable: true,
        cause: error,
      },
    );
  }

  if (statusCode !== undefined) {
    return new ModelProviderError(
      `DeepSeek request failed with HTTP ${statusCode}.`,
      {
        provider: "deepseek",
        statusCode,
        retryable: apiError?.isRetryable ?? false,
        cause: error,
      },
    );
  }

  return new ModelProviderError(
    "Could not complete the DeepSeek request. Check your network connection and try again.",
    {
      provider: "deepseek",
      retryable: true,
      cause: error,
    },
  );
}

function unwrapApiCallError(error: unknown): APICallError | undefined {
  if (APICallError.isInstance(error)) {
    return error;
  }

  if (RetryError.isInstance(error)) {
    return unwrapApiCallError(error.lastError);
  }

  if (typeof error === "object" && error !== null && "cause" in error) {
    return unwrapApiCallError(error.cause);
  }

  return undefined;
}
