/**
 * Answering "which models can this endpoint serve?" for the provider
 * configuration surface.
 *
 * Nothing here is stored. The request carries a draft the user is still
 * editing, and the reply is candidate metadata the surface offers for
 * adoption; user configuration remains the only thing that decides what a
 * route serves.
 *
 * Only OpenAI-compatible protocols are interrogated. Their listing is the one
 * shape a gateway, a self-hosted server, and the official endpoints all agree
 * on, which is the case this exists for.
 */

import {
  LISTABLE_PROVIDER_APIS,
  type ProviderApi,
  parseProviderBaseUrl,
  providerUrl,
} from "@forge/config";

/**
 * Replies larger than this are refused. The endpoint is whatever URL the user
 * typed, so the ceiling holds on the bytes actually read rather than on the
 * length the server claims. A truncated listing is not parseable, so an
 * overflow rejects instead of truncating.
 */
export const MAX_DISCOVERY_RESPONSE_BYTES = 4 * 1024 * 1024;

/** Discovery gives up on an endpoint that has not answered by then. */
export const DISCOVERY_TIMEOUT_MS = 15_000;

export class ModelDiscoveryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ModelDiscoveryError";
  }
}

/** One model an endpoint advertises. */
export interface DiscoveredModel {
  readonly id: string;
  readonly name?: string;
  readonly contextWindow?: number;
  readonly maxOutputTokens?: number;
}

export interface DiscoverModelsRequest {
  readonly api: ProviderApi;
  readonly baseUrl: string;
  /** Omitted or empty probes the endpoint unauthenticated. */
  readonly apiKey?: string;
  readonly signal?: AbortSignal;
  readonly fetch?: typeof globalThis.fetch;
}

/** Whether this protocol has a listing Forge knows how to read. */
export function canDiscoverModels(api: ProviderApi): boolean {
  return LISTABLE_PROVIDER_APIS.includes(api);
}

/**
 * One entry of an OpenAI-compatible listing reply. Fields are declared rather
 * than indexed so they can be read as properties under
 * `noPropertyAccessFromIndexSignature`. `name` and the capacity fields are
 * common gateway extensions, absent from the official listings.
 */
interface ListingEntry {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly display_name?: unknown;
  readonly context_window?: unknown;
  readonly context_length?: unknown;
  readonly max_tokens?: unknown;
  readonly max_output_tokens?: unknown;
}

/** A positive integer field of a listing entry, or undefined when unusable. */
function capacity(...candidates: readonly unknown[]): number | undefined {
  for (const candidate of candidates) {
    if (
      typeof candidate === "number" &&
      Number.isInteger(candidate) &&
      candidate > 0
    ) {
      return candidate;
    }
  }
  return undefined;
}

/** A non-empty string field of a listing entry, or undefined. */
function label(...candidates: readonly unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim() !== "") {
      return candidate.trim();
    }
  }
  return undefined;
}

/**
 * Accept one probe key, or refuse it before the header is built. Without this
 * `fetch` throws a ByteString `TypeError` that the network catch below would
 * report as "could not reach", blaming the network for a local fault.
 */
function usableProbeKey(raw: string): string {
  const key = raw.trim();
  for (const character of key) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code > 0x7e) {
      throw new ModelDiscoveryError(
        "this route's API key contains characters no HTTP header can carry; paste the raw key only",
      );
    }
  }
  return key;
}

/**
 * Read a reply body, refusing one that outgrows the ceiling. A declared length
 * is checked first so an honest server is turned away without transferring
 * anything; the accumulated total is what actually enforces the bound, because
 * a server that under-declares or streams says nothing useful up front.
 */
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

/**
 * Read one OpenAI-compatible listing reply. An entry without a usable id is
 * skipped rather than failing the whole interrogation: one malformed row
 * should not deny the user the rest of a working endpoint's catalog.
 */
export function readModelListing(body: unknown): DiscoveredModel[] {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) {
    throw new ModelDiscoveryError(
      "the endpoint's reply has no \"data\" array, so it is not an OpenAI-compatible model listing; enter this route's models by hand",
    );
  }
  const models: DiscoveredModel[] = [];
  for (const raw of data) {
    const entry = raw as ListingEntry | null;
    const id = label(entry?.id);
    if (id === undefined) continue;
    const name = label(entry?.name, entry?.display_name);
    const contextWindow = capacity(
      entry?.context_window,
      entry?.context_length,
    );
    const maxOutputTokens = capacity(
      entry?.max_output_tokens,
      entry?.max_tokens,
    );
    models.push({
      id,
      ...(name === undefined ? {} : { name }),
      ...(contextWindow === undefined ? {} : { contextWindow }),
      ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
    });
  }
  return models;
}

/**
 * Interrogate one draft endpoint for the models it advertises.
 *
 * @returns the advertised models in endpoint order.
 * @throws ModelDiscoveryError when the protocol has no readable listing, the
 *   endpoint refuses or fails the request, or the reply is not a listing. The
 *   caller is expected to fall back to hand-entered models.
 */
export async function discoverModels(
  request: DiscoverModelsRequest,
): Promise<readonly DiscoveredModel[]> {
  if (!canDiscoverModels(request.api)) {
    throw new ModelDiscoveryError(
      `${request.api} has no model listing Forge can read; enter this route's models by hand`,
    );
  }
  const baseUrl = parseProviderBaseUrl(request.baseUrl);
  const url = providerUrl(baseUrl, "/models");
  const authorized =
    request.apiKey !== undefined && request.apiKey.trim() !== "";
  const headers = {
    accept: "application/json",
    // An unauthenticated probe is deliberate: some self-hosted servers list
    // models without a key, and a blank field should not become "Bearer ".
    ...(authorized
      ? { authorization: `Bearer ${usableProbeKey(request.apiKey ?? "")}` }
      : {}),
  };

  const timeout = new AbortController();
  const timer = setTimeout(() => {
    timeout.abort(new Error("timeout"));
  }, DISCOVERY_TIMEOUT_MS);
  const signal =
    request.signal === undefined
      ? timeout.signal
      : AbortSignal.any([request.signal, timeout.signal]);

  let response: Response;
  try {
    response = await (request.fetch ?? globalThis.fetch)(url, {
      method: "GET",
      headers,
      signal,
      redirect: "follow",
    });
  } catch (error) {
    if (request.signal?.aborted) throw error;
    throw new ModelDiscoveryError(
      `could not reach ${url}; check the baseUrl and the network`,
      { cause: error },
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const detail =
      response.status === 401 || response.status === 403
        ? "; the endpoint rejected this API key"
        : response.status === 404
          ? "; this endpoint may not publish a model listing, so enter models by hand"
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
}
