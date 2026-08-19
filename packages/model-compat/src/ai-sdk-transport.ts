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

import { classifyReachFailure, reachAdvice } from "./reachability.js";
import type { CompatTransport, CompatTransportRequest } from "./transport.js";

type StreamTextFunction = typeof streamText;

/**
 * Dispatch for OpenAI-compatible endpoints.
 *
 * Both supported protocols are served by the same provider factory with a
 * caller-supplied `baseURL`; only the model constructor differs, because
 * `openai-completions` and `openai-responses` are two request shapes of the
 * same SDK provider rather than two providers.
 */
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
      apiKey: request.apiKey,
      baseURL: request.baseUrl,
      ...(this.#fetch ? { fetch: this.#fetch } : {}),
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
        // A gear the model does not declare sends no reasoning parameter at
        // all, because a gateway that does not reason rejects the field rather
        // than ignoring it.
        ...(request.reasoningEffort === undefined
          ? {}
          : {
              providerOptions: {
                openai: { reasoningEffort: request.reasoningEffort },
              },
            }),
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
        yield {
          type: "finish",
          finishReason: finish.finishReason,
          usage: normalizeUsage(finish.usage),
          ...(metadata ? { providerMetadata: metadata } : {}),
          continuation: {
            // Tagged with the route so a continuation cannot be replayed
            // against a different endpoint after configuration changes.
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

/**
 * Map a transport failure to a Forge provider error. Messages name the route
 * rather than a vendor, because the endpoint is whatever the user configured
 * and blaming "OpenAI" for a self-hosted gateway's 500 would misdirect.
 */
export function mapCompatError(
  error: unknown,
  route: string,
): ModelProviderError {
  if (error instanceof ModelProviderError) return error;
  const apiError = unwrapApiCallError(error);
  const statusCode = apiError?.statusCode;
  if (statusCode === 401 || statusCode === 403) {
    return new ModelProviderError(
      `Provider route "${route}" rejected the API key. Check the credential saved for this route.`,
      { provider: route, statusCode, retryable: false, cause: error },
    );
  }
  if (statusCode === 404) {
    return new ModelProviderError(
      `Provider route "${route}" answered HTTP 404. Check the route's baseUrl and that the model id exists on this endpoint.`,
      { provider: route, statusCode, retryable: false, cause: error },
    );
  }
  if (statusCode === 429) {
    return new ModelProviderError(
      `Provider route "${route}" reported a rate or quota limit.`,
      { provider: route, statusCode, retryable: true, cause: error },
    );
  }
  if (statusCode !== undefined && statusCode >= 500) {
    return new ModelProviderError(
      `Provider route "${route}" is temporarily unavailable.`,
      { provider: route, statusCode, retryable: true, cause: error },
    );
  }
  if (statusCode !== undefined) {
    return new ModelProviderError(
      `Provider route "${route}" request failed with HTTP ${statusCode}.`,
      {
        provider: route,
        statusCode,
        retryable: apiError?.isRetryable ?? false,
        cause: error,
      },
    );
  }
  // No status code means the endpoint never answered, so the advice depends
  // on how far the request got rather than on the provider.
  const failure = classifyReachFailure(error);
  return new ModelProviderError(
    `Could not reach provider route "${route}": ${reachAdvice(failure)}.`,
    { provider: route, retryable: failure !== "dns", cause: error },
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
