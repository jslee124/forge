/** Wire protocols supported by a configured provider route. */
export const PROVIDER_APIS = [
  "openai-completions",
  "openai-responses",
] as const;

export type ProviderApi = (typeof PROVIDER_APIS)[number];

export const LISTABLE_PROVIDER_APIS: readonly ProviderApi[] = [
  "openai-completions",
  "openai-responses",
];

export const RESERVED_PROVIDER_ROUTES: readonly string[] = [
  "codex",
  "deepseek",
  "forge",
  "openai",
];

export class ProviderEndpointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderEndpointError";
  }
}

export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLocaleLowerCase();
  if (host === "localhost" || host === "[::1]") return true;
  const octets = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(host);
  if (!octets) return false;
  const parts = octets.slice(1).map(Number);
  return parts.every((part) => part <= 255) && parts[0] === 127;
}

/** Validate an endpoint before any credential can be sent to it. */
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
      `"${trimmed}" would send traffic over plaintext http; use https, or a loopback host such as http://localhost:11434/v1`,
    );
  }
  if (url.username !== "" || url.password !== "") {
    throw new ProviderEndpointError(
      "a provider baseUrl must not embed a username or password; use the route authentication field",
    );
  }
  if (url.search !== "" || url.hash !== "") {
    throw new ProviderEndpointError(
      "a provider baseUrl must not carry a query string or fragment",
    );
  }
  return `${url.origin}${url.pathname.replace(/\/+$/u, "")}`;
}

/** Preserve deployment prefixes such as `/openai/v1`. */
export function providerUrl(baseUrl: string, endpointPath: string): string {
  const suffix = endpointPath.startsWith("/")
    ? endpointPath
    : `/${endpointPath}`;
  return `${baseUrl.replace(/\/+$/u, "")}${suffix}`;
}
