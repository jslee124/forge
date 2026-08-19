/**
 * Telling apart the ways an endpoint can fail to answer.
 *
 * A request that never reached the endpoint and one the endpoint refused need
 * different advice, and a wrong host name needs different advice from a
 * blocked network. Collapsing all of them into "check the network and the
 * baseUrl" makes the user test both when only one can be at fault.
 */

/** Codes meaning the host name never resolved. */
const DNS_FAILURE_CODES: ReadonlySet<string> = new Set([
  "EAI_AGAIN",
  "ENOTFOUND",
]);

/** Codes meaning the address resolved but no usable connection was made. */
const CONNECT_FAILURE_CODES: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

export type ReachFailure = "dns" | "connect" | "unknown";

/** Most errors reachable from one failure before the search gives up. */
const MAX_VISITED_ERRORS = 32;

/**
 * Classify why an endpoint did not answer.
 *
 * The actionable code sits several levels below the message the caller sees,
 * and libraries nest it in more than one way: a `cause`, a retry wrapper's
 * `lastError`, or an aggregate's `errors`. A real failure arrives here as
 * `ModelProviderError -> RetryError -> APICallError -> ConnectTimeoutError`,
 * where only the last link carries the code and the second link exposes it
 * through `lastError` rather than `cause`. Following `cause` alone therefore
 * reported every retried connection failure as unknown.
 */
export function classifyReachFailure(error: unknown): ReachFailure {
  const seen = new Set<unknown>();
  const pending: unknown[] = [error];
  while (pending.length > 0 && seen.size < MAX_VISITED_ERRORS) {
    const current = pending.shift();
    if (typeof current !== "object" || current === null) continue;
    // A cause chain may be self-referential, so identity is what bounds this.
    if (seen.has(current)) continue;
    seen.add(current);

    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") {
      if (DNS_FAILURE_CODES.has(code)) return "dns";
      if (CONNECT_FAILURE_CODES.has(code)) return "connect";
    }

    pending.push((current as { cause?: unknown }).cause);
    pending.push((current as { lastError?: unknown }).lastError);
    const aggregated = (current as { errors?: unknown }).errors;
    if (Array.isArray(aggregated)) pending.push(...aggregated);
  }
  return "unknown";
}

/**
 * Advice for a request that never reached the endpoint.
 *
 * The proxy sentence exists because Node does not read `HTTP_PROXY` or
 * `HTTPS_PROXY` on its own: a user whose shell, curl, and browser all work
 * through a proxy sees Forge alone time out, with nothing pointing at the
 * cause. Forge deliberately does not configure a proxy itself, since a
 * proxy decides where the API key travels and belongs to the process
 * environment rather than to repository or route configuration.
 */
export function reachAdvice(failure: ReachFailure): string {
  switch (failure) {
    case "dns":
      return "the host name did not resolve, so check the route's baseUrl";
    case "connect":
      return "the address resolved but refused or timed out. If this network needs a proxy, run Forge with NODE_USE_ENV_PROXY=1 and HTTPS_PROXY set, because Node does not read those variables on its own";
    default:
      return "check the network and the route's baseUrl";
  }
}
