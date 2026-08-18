import {
  createDeepSeek,
  type DeepSeekLanguageModelChatOptions,
} from "@ai-sdk/deepseek";
import {
  ModelProviderError,
  type ModelStreamEvent,
  type ModelToolDefinition,
  type ModelUsage,
} from "@forge/core";
import {
  APICallError,
  type LanguageModelUsage,
  RetryError,
  streamText,
  type ToolSet,
  tool,
} from "ai";

import type {
  DeepSeekTransport,
  DeepSeekTransportRequest,
} from "./transport.js";

type StreamTextFunction = typeof streamText;

export class AiSdkDeepSeekTransport implements DeepSeekTransport {
  readonly #streamText: StreamTextFunction;

  constructor(streamTextFunction: StreamTextFunction = streamText) {
    this.#streamText = streamTextFunction;
  }

  async *stream(
    request: DeepSeekTransportRequest,
    signal: AbortSignal,
  ): AsyncIterable<ModelStreamEvent> {
    const deepSeek = createDeepSeek({ apiKey: request.apiKey });
    let providerMetadata: Readonly<Record<string, unknown>> | undefined;

    try {
      const result = this.#streamText({
        model: deepSeek(request.model),
        prompt: request.prompt,
        abortSignal: signal,
        ...(request.tools && request.tools.length > 0
          ? { tools: toAiSdkTools(request.tools) }
          : {}),
        providerOptions: {
          deepseek: {
            thinking: { type: request.thinking },
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
            const finishEvent: ModelStreamEvent = {
              type: "finish",
              finishReason: part.finishReason,
              usage: normalizeUsage(part.totalUsage),
              ...(providerMetadata ? { providerMetadata } : {}),
            };
            yield finishEvent;
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
