/**
 * Third-party provider endpoint validation.
 *
 * A configured provider route sends its stored API key to whatever address the
 * configuration names, so the endpoint is checked before anything uses it
 * rather than at the first request.
 */

/** Route names reserved for engines and built-in providers. */
export const RESERVED_PROVIDER_ROUTES: readonly string[] = [
  "codex",
  "deepseek",
  "forge",
  "openai",
];

/** Wire protocols a third-party route may speak. */
export const PROVIDER_APIS = [
  "openai-completions",
  "openai-responses",
] as const;

export type ProviderApi = (typeof PROVIDER_APIS)[number];

/**
 * Protocols whose model listing can be read over the wire. Both speak OpenAI's
 * `GET /models` shape with bearer authentication, which is the one response
 * shape gateways, self-hosted servers, and the official endpoints agree on.
 */
export const LISTABLE_PROVIDER_APIS: readonly ProviderApi[] = [
  "openai-completions",
  "openai-responses",
];

/**
 * Whether a host resolves to this machine. Plain HTTP is accepted only here,
 * because a local gateway such as Ollama or vLLM has no certificate while an
 * external plaintext endpoint would put the API key on the network.
 */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLocaleLowerCase();
  if (host === "localhost" || host === "[::1]") return true;
  const octets = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(host);
  if (!octets) return false;
  const parts = octets.slice(1).map(Number);
  return parts.every((part) => part <= 255) && parts[0] === 127;
}

export class ProviderEndpointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderEndpointError";
  }
}

/**
 * Validate one provider endpoint and return its canonical prefix form.
 *
 * Trailing slashes are removed so callers can join paths by concatenation. A
 * deployment path such as `https://gateway.example/openai/v1` must keep its
 * segments, which resolving `/models` against it as a URL would discard.
 *
 * @param raw - the endpoint as typed into configuration or the login form.
 * @returns the endpoint without a trailing slash.
 * @throws ProviderEndpointError when the endpoint is unusable or would send
 *   the API key over plaintext to a host that is not this machine.
 */
export function parseProviderBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "") {
    throw new ProviderEndpointError("a provider baseUrl must not be empty");
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new ProviderEndpointError(
      `"${trimmed}" is not a valid URL; include the scheme, as in https://gateway.example/v1`,
    );
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ProviderEndpointError(
      `a provider baseUrl must use https (or http on this machine), not "${url.protocol}"`,
    );
  }
  if (url.protocol === "http:" && !isLoopbackHost(url.hostname)) {
    throw new ProviderEndpointError(
      `"${trimmed}" would send the API key over plaintext http; use https, or a loopback host such as http://localhost:11434/v1`,
    );
  }
  // Credentials belong in the key field, never in a URL that is logged,
  // displayed in the model picker, and written to configuration.
  if (url.username !== "" || url.password !== "") {
    throw new ProviderEndpointError(
      "a provider baseUrl must not embed a username or password; use the API key field",
    );
  }
  // A query or fragment cannot survive being concatenated with a path.
  if (url.search !== "" || url.hash !== "") {
    throw new ProviderEndpointError(
      "a provider baseUrl must not carry a query string or fragment",
    );
  }
  return `${url.origin}${url.pathname.replace(/\/+$/u, "")}`;
}

/**
 * Join a validated endpoint with a listing or request path. The endpoint is
 * treated as a prefix rather than a base to resolve against, so deployment
 * path segments are preserved.
 */
export function providerUrl(baseUrl: string, endpointPath: string): string {
  const suffix = endpointPath.startsWith("/")
    ? endpointPath
    : `/${endpointPath}`;
  return `${baseUrl.replace(/\/+$/u, "")}${suffix}`;
}
