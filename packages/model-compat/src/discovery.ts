import {
  LISTABLE_PROVIDER_APIS,
  type ProviderApi,
  parseProviderBaseUrl,
  providerUrl,
} from "@forge/config";

export const MAX_DISCOVERY_RESPONSE_BYTES = 4 * 1024 * 1024;
export const DISCOVERY_TIMEOUT_MS = 15_000;

export class ModelDiscoveryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ModelDiscoveryError";
  }
}

export interface DiscoveredModel {
  readonly id: string;
  readonly name?: string;
  readonly contextWindow?: number;
  readonly maxOutputTokens?: number;
  /** Optional provider-advertised controls. Absence means unknown, not false. */
  readonly reasoningEfforts?: readonly DiscoveredReasoningEffort[];
}

export const DISCOVERABLE_REASONING_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
] as const;
export type DiscoveredReasoningEffort =
  (typeof DISCOVERABLE_REASONING_EFFORTS)[number];

export interface DiscoverModelsRequest {
  readonly api: ProviderApi;
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly signal?: AbortSignal;
  readonly fetch?: typeof globalThis.fetch;
}

export function canDiscoverModels(api: ProviderApi): boolean {
  return LISTABLE_PROVIDER_APIS.includes(api);
}

interface ListingEntry {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly display_name?: unknown;
  readonly context_window?: unknown;
  readonly context_length?: unknown;
  readonly max_tokens?: unknown;
  readonly max_output_tokens?: unknown;
  readonly reasoning_efforts?: unknown;
  readonly supported_reasoning_efforts?: unknown;
  readonly capabilities?: unknown;
  readonly reasoning?: unknown;
}

function property(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && key in value
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function reasoningEfforts(
  entry: ListingEntry,
): readonly DiscoveredReasoningEffort[] | undefined {
  const capabilitiesReasoning = property(entry.capabilities, "reasoning");
  const candidates = [
    entry.reasoning_efforts,
    entry.supported_reasoning_efforts,
    property(capabilitiesReasoning, "efforts"),
    property(entry.reasoning, "efforts"),
    property(entry.reasoning, "supported_efforts"),
  ];
  const advertised = candidates.find(Array.isArray);
  if (!Array.isArray(advertised)) return undefined;
  const allowed = new Set<string>(DISCOVERABLE_REASONING_EFFORTS);
  const efforts = [
    ...new Set(
      advertised.filter(
        (value): value is DiscoveredReasoningEffort =>
          typeof value === "string" && allowed.has(value),
      ),
    ),
  ].slice(0, DISCOVERABLE_REASONING_EFFORTS.length);
  return efforts.length === 0 ? undefined : efforts;
}

function capacity(...candidates: readonly unknown[]): number | undefined {
  return candidates.find(
    (candidate): candidate is number =>
      typeof candidate === "number" &&
      Number.isInteger(candidate) &&
      candidate > 0 &&
      candidate <= 20_000_000,
  );
}

function label(...candidates: readonly unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim() !== "") {
      return candidate.trim().slice(0, 512);
    }
  }
  return undefined;
}

function usableProbeKey(raw: string): string {
  const key = raw.trim();
  for (const character of key) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code > 0x7e) {
      throw new ModelDiscoveryError(
        "the API key contains characters no HTTP header can carry",
      );
    }
  }
  return key;
}

async function readBounded(response: Response, url: string): Promise<string> {
  const oversized = (): ModelDiscoveryError =>
    new ModelDiscoveryError(
      `${url} answered with more than ${MAX_DISCOVERY_RESPONSE_BYTES} bytes`,
    );
  const declared = Number(response.headers.get("content-length") ?? Number.NaN);
  if (Number.isFinite(declared) && declared > MAX_DISCOVERY_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw oversized();
  }
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_DISCOVERY_RESPONSE_BYTES) throw oversized();
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

export function readModelListing(body: unknown): DiscoveredModel[] {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) {
    throw new ModelDiscoveryError(
      'the endpoint reply has no "data" array; enter models by hand',
    );
  }
  const models: DiscoveredModel[] = [];
  const seen = new Set<string>();
  for (const raw of data) {
    const entry = raw as ListingEntry | null;
    const id = label(entry?.id);
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    const name = label(entry?.name, entry?.display_name)?.slice(0, 128);
    const contextWindow = capacity(
      entry?.context_window,
      entry?.context_length,
    );
    const maxOutputTokens = capacity(
      entry?.max_output_tokens,
      entry?.max_tokens,
    );
    const advertisedReasoningEfforts = entry
      ? reasoningEfforts(entry)
      : undefined;
    models.push({
      id,
      ...(name === undefined ? {} : { name }),
      ...(contextWindow === undefined ? {} : { contextWindow }),
      ...(maxOutputTokens === undefined || maxOutputTokens > 2_000_000
        ? {}
        : { maxOutputTokens }),
      ...(advertisedReasoningEfforts === undefined
        ? {}
        : { reasoningEfforts: advertisedReasoningEfforts }),
    });
    if (models.length >= 256) break;
  }
  return models;
}

export async function discoverModels(
  request: DiscoverModelsRequest,
): Promise<readonly DiscoveredModel[]> {
  if (!canDiscoverModels(request.api)) {
    throw new ModelDiscoveryError(
      `${request.api} has no model listing Forge can read`,
    );
  }
  const baseUrl = parseProviderBaseUrl(request.baseUrl);
  const url = providerUrl(baseUrl, "/models");
  const authorized =
    request.apiKey !== undefined && request.apiKey.trim() !== "";
  const timeout = new AbortController();
  const timer = setTimeout(
    () => timeout.abort(new Error("model discovery timed out")),
    DISCOVERY_TIMEOUT_MS,
  );
  const signal = request.signal
    ? AbortSignal.any([request.signal, timeout.signal])
    : timeout.signal;

  try {
    const response = await (request.fetch ?? globalThis.fetch)(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        ...(authorized
          ? { authorization: `Bearer ${usableProbeKey(request.apiKey ?? "")}` }
          : {}),
      },
      signal,
      // Never forward a route credential to a redirect target.
      redirect: "error",
    });
    if (!response.ok) {
      const detail =
        response.status === 401 || response.status === 403
          ? "; the endpoint rejected this credential"
          : response.status === 404
            ? "; this endpoint may not publish a model listing"
            : "";
      throw new ModelDiscoveryError(
        `${url} answered HTTP ${response.status}${detail}`,
      );
    }
    const text = await readBounded(response, url);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new ModelDiscoveryError(`${url} did not answer with JSON`, {
        cause: error,
      });
    }
    return readModelListing(parsed);
  } catch (error) {
    if (error instanceof ModelDiscoveryError || request.signal?.aborted) {
      throw error;
    }
    throw new ModelDiscoveryError(`could not read models from ${url}`, {
      cause: error,
    });
  } finally {
    clearTimeout(timer);
  }
}
