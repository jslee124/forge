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

import type { OpenAITransport, OpenAITransportRequest } from "./transport.js";

type StreamTextFunction = typeof streamText;

export class AiSdkOpenAITransport implements OpenAITransport {
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
    request: OpenAITransportRequest,
    signal: AbortSignal,
  ): AsyncIterable<ModelStreamEvent> {
    const openai = createOpenAI({
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
        model: openai.responses(request.model),
        ...(request.instructions ? { instructions: request.instructions } : {}),
        messages,
        abortSignal: signal,
        onError: () => undefined,
        ...(request.tools?.length
          ? { tools: toAiSdkTools(request.tools) }
          : {}),
        providerOptions: {
          openai: {
            reasoningEffort: request.reasoningEffort,
            store: false,
          } satisfies OpenAIResponsesProviderOptions,
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
            throw mapOpenAIError(part.error);
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
            provider: "openai",
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
      throw mapOpenAIError(error);
    }
  }
}

function buildMessages(request: OpenAITransportRequest): ModelMessage[] {
  let messages: ModelMessage[];
  if (request.continuation) {
    const data = request.continuation.data;
    if (
      request.continuation.provider !== "openai" ||
      typeof data !== "object" ||
      data === null ||
      !("messages" in data) ||
      !Array.isArray(data.messages)
    ) {
      throw new ModelProviderError(
        "OpenAI received incompatible continuation data.",
        { provider: "openai", retryable: false },
      );
    }
    messages = [...data.messages] as ModelMessage[];
  } else {
    messages = [
      ...(request.conversation ?? []),
      { role: "user", content: request.prompt },
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
  return "OpenAI returned an unrecognized provider warning.";
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

export function mapOpenAIError(error: unknown): ModelProviderError {
  if (error instanceof ModelProviderError) return error;
  if (InvalidPromptError.isInstance(error)) {
    return new ModelProviderError(
      "Could not construct the OpenAI API request. Check the prompt and model configuration.",
      { provider: "openai", retryable: false, cause: error },
    );
  }
  const apiError = unwrapApiCallError(error);
  const statusCode = apiError?.statusCode;
  if (statusCode === 401 || statusCode === 403) {
    return new ModelProviderError(
      "OpenAI rejected the API key. Check OPENAI_API_KEY. ChatGPT subscription access uses `forge codex` instead.",
      { provider: "openai", statusCode, retryable: false, cause: error },
    );
  }
  if (statusCode === 429) {
    return new ModelProviderError(
      "OpenAI API rate or quota limit reached. Check API billing and try again later.",
      { provider: "openai", statusCode, retryable: true, cause: error },
    );
  }
  if (statusCode !== undefined && statusCode >= 500) {
    return new ModelProviderError("OpenAI API is temporarily unavailable.", {
      provider: "openai",
      statusCode,
      retryable: true,
      cause: error,
    });
  }
  if (statusCode !== undefined) {
    return new ModelProviderError(
      `OpenAI API request failed with HTTP ${statusCode}.`,
      {
        provider: "openai",
        statusCode,
        retryable: apiError?.isRetryable ?? false,
        cause: error,
      },
    );
  }
  return new ModelProviderError(
    "Could not complete the OpenAI API request. Check the network and model configuration.",
    { provider: "openai", retryable: true, cause: error },
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
