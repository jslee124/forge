export interface ModelRequest {
  readonly prompt: string;
}

export interface ModelUsage {
  readonly inputTokens: number | undefined;
  readonly outputTokens: number | undefined;
  readonly reasoningTokens: number | undefined;
  readonly cachedInputTokens: number | undefined;
  readonly cacheWriteTokens: number | undefined;
  readonly totalTokens: number | undefined;
}

export type ModelFinishReason =
  | "stop"
  | "length"
  | "content-filter"
  | "tool-calls"
  | "error"
  | "other";

export type ModelStreamEvent =
  | {
      readonly type: "reasoning.delta";
      readonly text: string;
    }
  | {
      readonly type: "text.delta";
      readonly text: string;
    }
  | {
      readonly type: "warning";
      readonly message: string;
    }
  | {
      readonly type: "finish";
      readonly finishReason: ModelFinishReason;
      readonly usage: ModelUsage;
      readonly providerMetadata?: Readonly<Record<string, unknown>>;
    }
  | {
      readonly type: "abort";
      readonly reason?: string;
    };

export interface ModelAdapter {
  stream(
    request: ModelRequest,
    signal: AbortSignal,
  ): AsyncIterable<ModelStreamEvent>;
}
