export class ModelConfigurationError extends Error {
  readonly code = "MODEL_CONFIGURATION_ERROR";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ModelConfigurationError";
  }
}

export class ModelProviderError extends Error {
  readonly code = "MODEL_PROVIDER_ERROR";
  readonly provider: string;
  readonly statusCode: number | undefined;
  readonly retryable: boolean;

  constructor(
    message: string,
    options: {
      readonly provider: string;
      readonly statusCode?: number;
      readonly retryable?: boolean;
      readonly cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = "ModelProviderError";
    this.provider = options.provider;
    this.statusCode = options.statusCode;
    this.retryable = options.retryable ?? false;
  }
}
