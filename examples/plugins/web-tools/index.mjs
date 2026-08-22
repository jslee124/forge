import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const BRAVE_SEARCH_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const DUCKDUCKGO_SEARCH_ENDPOINT = "https://html.duckduckgo.com/html/";
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_DOWNLOAD_BYTES = 1_048_576;
const MAX_REDIRECTS = 5;
const USER_AGENT = "ForgeWebTools/1.0 (+https://github.com/jslee124/forge)";

export default function activate(api) {
  for (const tool of createWebTools(api)) {
    api.registerTool(tool);
  }
}

export function createWebTools(api, dependencies = {}) {
  const fetchImplementation = dependencies.fetch ?? globalThis.fetch;
  const lookupAll = dependencies.lookupAll ?? defaultLookupAll;
  const environment = dependencies.env ?? process.env;
  if (typeof fetchImplementation !== "function") {
    throw new Error(
      "The web-tools plugin requires a global fetch implementation.",
    );
  }

  const searchInputSchema = api.z
    .object({
      query: api.z.string().trim().min(1).max(400),
      maxResults: api.z.number().int().min(1).max(10).default(5),
      provider: api.z.enum(["auto", "brave", "duckduckgo"]).default("auto"),
    })
    .strict();
  const fetchInputSchema = api.z
    .object({
      url: api.z.string().trim().min(1).max(2_048),
      maxCharacters: api.z.number().int().min(256).max(50_000).default(20_000),
      timeoutMs: api.z
        .number()
        .int()
        .min(1_000)
        .max(20_000)
        .default(DEFAULT_TIMEOUT_MS),
    })
    .strict();

  return [
    {
      name: "web_search",
      description:
        "Search the public web and return bounded titles, URLs, and snippets. Uses Brave Search when BRAVE_SEARCH_API_KEY is set, otherwise DuckDuckGo HTML.",
      risk: "network",
      inputSchema: searchInputSchema,
      execute: async (input, context) => {
        const parsed = searchInputSchema.safeParse(input);
        if (!parsed.success) {
          return failure("invalid_input", "Invalid input for web_search.");
        }
        return executeWebSearch(parsed.data, context, {
          fetchImplementation,
          lookupAll,
          environment,
        });
      },
    },
    {
      name: "web_fetch",
      description:
        "Fetch readable text from a public HTTP(S) page with redirect, address, MIME, timeout, download, and output limits.",
      risk: "network",
      inputSchema: fetchInputSchema,
      execute: async (input, context) => {
        const parsed = fetchInputSchema.safeParse(input);
        if (!parsed.success) {
          return failure("invalid_input", "Invalid input for web_fetch.");
        }
        return executeWebFetch(parsed.data, context, {
          environment,
          fetchImplementation,
          lookupAll,
        });
      },
    },
  ];
}

async function executeWebSearch(input, context, dependencies) {
  if (context.signal.aborted) return cancelled();
  const braveKey = dependencies.environment.BRAVE_SEARCH_API_KEY?.trim();
  const provider =
    input.provider === "auto"
      ? braveKey
        ? "brave"
        : "duckduckgo"
      : input.provider;
  if (provider === "brave" && !braveKey) {
    return failure(
      "invalid_input",
      "BRAVE_SEARCH_API_KEY is required when web_search provider is brave.",
    );
  }

  try {
    const results =
      provider === "brave"
        ? await searchBrave(input, braveKey, context, dependencies)
        : await searchDuckDuckGo(input, context, dependencies);
    return boundSearchOutput(
      { query: input.query, provider },
      results,
      input.maxResults,
      context,
    );
  } catch (error) {
    return toolFailure(error, context.signal);
  }
}

async function searchBrave(input, apiKey, context, dependencies) {
  const url = new URL(BRAVE_SEARCH_ENDPOINT);
  url.searchParams.set("q", input.query);
  url.searchParams.set("count", String(input.maxResults));
  url.searchParams.set("safesearch", "moderate");
  const response = await requestWithRedirects(url, {
    fetchImplementation: dependencies.fetchImplementation,
    headers: {
      accept: "application/json",
      "accept-encoding": "identity",
      "user-agent": USER_AGENT,
      "x-subscription-token": apiKey,
    },
    lookupAll: dependencies.lookupAll,
    maxRedirects: 1,
    environment: dependencies.environment,
    signal: context.signal,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  });
  ensureSuccessfulResponse(response);
  const contentType = mediaType(response.headers.get("content-type"));
  if (contentType !== "application/json") {
    throw new WebToolError(
      "io_error",
      `Brave Search returned unsupported content type ${contentType || "unknown"}.`,
      true,
    );
  }
  const body = await readResponseText(response, MAX_DOWNLOAD_BYTES);
  let payload;
  try {
    payload = JSON.parse(body.text);
  } catch {
    throw new WebToolError(
      "io_error",
      "Brave Search returned invalid JSON.",
      true,
    );
  }
  const rawResults = Array.isArray(payload?.web?.results)
    ? payload.web.results
    : [];
  return rawResults.flatMap((result) => {
    if (typeof result?.title !== "string" || typeof result?.url !== "string") {
      return [];
    }
    return [
      {
        title: normalizeText(result.title),
        url: result.url,
        snippet:
          typeof result.description === "string"
            ? normalizeText(stripHtml(result.description))
            : "",
      },
    ];
  });
}

async function searchDuckDuckGo(input, context, dependencies) {
  const url = new URL(DUCKDUCKGO_SEARCH_ENDPOINT);
  url.searchParams.set("q", input.query);
  const response = await requestWithRedirects(url, {
    fetchImplementation: dependencies.fetchImplementation,
    headers: {
      accept: "text/html,application/xhtml+xml",
      "accept-encoding": "identity",
      "user-agent": USER_AGENT,
    },
    lookupAll: dependencies.lookupAll,
    maxRedirects: 2,
    environment: dependencies.environment,
    signal: context.signal,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  });
  ensureSuccessfulResponse(response);
  const contentType = mediaType(response.headers.get("content-type"));
  if (contentType !== "text/html" && contentType !== "application/xhtml+xml") {
    throw new WebToolError(
      "io_error",
      `DuckDuckGo returned unsupported content type ${contentType || "unknown"}.`,
      true,
    );
  }
  const body = await readResponseText(response, MAX_DOWNLOAD_BYTES);
  return parseDuckDuckGoResults(body.text);
}

async function executeWebFetch(input, context, dependencies) {
  if (context.signal.aborted) return cancelled();
  let initialUrl;
  try {
    initialUrl = parsePublicHttpUrl(input.url);
  } catch (error) {
    return toolFailure(error, context.signal);
  }

  try {
    const response = await requestWithRedirects(initialUrl, {
      fetchImplementation: dependencies.fetchImplementation,
      headers: {
        accept:
          "text/html,text/plain,text/markdown,application/json,application/xml,application/xhtml+xml,application/rss+xml,application/atom+xml",
        "accept-encoding": "identity",
        "user-agent": USER_AGENT,
      },
      lookupAll: dependencies.lookupAll,
      maxRedirects: MAX_REDIRECTS,
      environment: dependencies.environment,
      signal: context.signal,
      timeoutMs: input.timeoutMs,
    });
    ensureSuccessfulResponse(response);
    const contentType = mediaType(response.headers.get("content-type"));
    if (!isReadableContentType(contentType)) {
      throw new WebToolError(
        "invalid_input",
        `web_fetch only accepts readable text content; received ${contentType || "unknown"}.`,
      );
    }
    const body = await readResponseText(response, MAX_DOWNLOAD_BYTES);
    const extracted = extractReadableText(body.text, contentType);
    const limitedByCharacters = extracted.text.slice(0, input.maxCharacters);
    const characterTruncated =
      limitedByCharacters.length < extracted.text.length;
    const base = {
      url: initialUrl.href,
      finalUrl: response.url || initialUrl.href,
      status: response.status,
      contentType,
      ...(extracted.title ? { title: extracted.title } : {}),
    };
    const bounded = boundTextOutput(
      base,
      limitedByCharacters,
      context.limits.maxOutputBytes,
    );
    if (!bounded) {
      return failure(
        "output_limit",
        "The web_fetch metadata exceeds the configured tool output limit.",
      );
    }
    return {
      ok: true,
      output: bounded.output,
      truncated: body.truncated || characterTruncated || bounded.truncated,
    };
  } catch (error) {
    return toolFailure(error, context.signal);
  }
}

async function requestWithRedirects(initialUrl, options) {
  let url = parsePublicHttpUrl(initialUrl.href);
  for (let redirectCount = 0; ; redirectCount += 1) {
    await assertSafeDestination(url, options.lookupAll, options.environment);
    const response = await fetchWithTimeout(
      options.fetchImplementation,
      url,
      {
        headers: options.headers,
        redirect: "manual",
      },
      options.signal,
      options.timeoutMs,
    );
    if (!isRedirect(response.status)) return response;
    if (redirectCount >= options.maxRedirects) {
      throw new WebToolError(
        "io_error",
        `The request exceeded ${options.maxRedirects} redirects.`,
      );
    }
    const location = response.headers.get("location");
    if (!location) {
      throw new WebToolError(
        "io_error",
        "The server returned a redirect without a Location header.",
      );
    }
    url = parsePublicHttpUrl(new URL(location, url).href);
  }
}

async function fetchWithTimeout(
  fetchImplementation,
  url,
  init,
  parentSignal,
  timeoutMs,
) {
  const timeoutController = new AbortController();
  const timer = setTimeout(
    () => timeoutController.abort(new Error("request timed out")),
    timeoutMs,
  );
  const signal = AbortSignal.any([parentSignal, timeoutController.signal]);
  try {
    return await fetchImplementation(url, { ...init, signal });
  } catch (error) {
    if (parentSignal.aborted) {
      throw new WebToolError("cancelled", "The web request was cancelled.");
    }
    if (timeoutController.signal.aborted) {
      throw new WebToolError(
        "timed_out",
        `The web request exceeded ${timeoutMs} ms.`,
        true,
      );
    }
    throw new WebToolError(
      "io_error",
      "The web request failed before a response was received.",
      true,
      { cause: error },
    );
  } finally {
    clearTimeout(timer);
  }
}

async function readResponseText(response, maxBytes) {
  if (!response.body) return { text: "", truncated: false };
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  let truncated = false;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const remaining = maxBytes - bytes;
      if (next.value.byteLength > remaining) {
        if (remaining > 0) chunks.push(next.value.subarray(0, remaining));
        bytes = maxBytes;
        truncated = true;
        await reader.cancel();
        break;
      }
      chunks.push(next.value);
      bytes += next.value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(combined), truncated };
}

function parsePublicHttpUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new WebToolError("invalid_input", "web_fetch requires a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new WebToolError(
      "invalid_input",
      "Only http:// and https:// URLs are supported.",
    );
  }
  if (url.username || url.password) {
    throw new WebToolError(
      "invalid_input",
      "URLs containing credentials are not allowed.",
    );
  }
  const expectedPort = url.protocol === "https:" ? "443" : "80";
  if (url.port && url.port !== expectedPort) {
    throw new WebToolError(
      "invalid_input",
      "Only the standard HTTP and HTTPS ports are allowed.",
    );
  }
  return url;
}

async function assertSafeDestination(url, lookupAll, environment) {
  const normalized = url.hostname
    .replace(/^\[|\]$/gu, "")
    .replace(/\.$/u, "")
    .toLowerCase();
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    normalized.endsWith(".home") ||
    normalized.endsWith(".lan")
  ) {
    throw blockedAddressError();
  }
  const literalFamily = isIP(normalized);
  if (literalFamily) {
    if (isBlockedAddress(normalized)) throw blockedAddressError();
    return;
  }
  if (usesHttpProxy(url, environment)) return;
  const addresses = await lookupAll(normalized).catch((error) => {
    throw new WebToolError(
      "io_error",
      "The destination hostname could not be resolved.",
      true,
      { cause: error },
    );
  });
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => isBlockedAddress(address))
  ) {
    throw blockedAddressError();
  }
}

function usesHttpProxy(url, environment) {
  const httpProxy = environment.http_proxy ?? environment.HTTP_PROXY;
  const httpsProxy = environment.https_proxy ?? environment.HTTPS_PROXY;
  const proxy =
    url.protocol === "https:"
      ? httpsProxy || httpProxy
      : url.protocol === "http:"
        ? httpProxy
        : undefined;
  if (!isSupportedProxyUrl(proxy) || bypassesProxy(url, environment)) {
    return false;
  }
  return true;
}

function isSupportedProxyUrl(value) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function bypassesProxy(url, environment) {
  const noProxy = environment.no_proxy ?? environment.NO_PROXY ?? "";
  if (noProxy === "*") return true;
  const hostname = url.hostname
    .replace(/^\[|\]$/gu, "")
    .replace(/\.$/u, "")
    .toLowerCase();
  const port =
    Number.parseInt(url.port, 10) || (url.protocol === "https:" ? 443 : 80);
  return noProxy.split(/[,\s]/u).some((entry) => {
    if (!entry) return false;
    const parsed = entry.match(/^(.+):(\d+)$/u);
    const entryPort = parsed ? Number.parseInt(parsed[2], 10) : 0;
    if (entryPort && entryPort !== port) return false;
    const entryHostname = (parsed ? parsed[1] : entry)
      .replace(/^\*?\./u, "")
      .toLowerCase();
    return hostname === entryHostname || hostname.endsWith(`.${entryHostname}`);
  });
}

async function defaultLookupAll(hostname) {
  return lookup(hostname, { all: true, verbatim: true });
}

function isBlockedAddress(address) {
  const family = isIP(address);
  if (family === 4) return isBlockedIpv4(address);
  if (family === 6) return isBlockedIpv6(address);
  return true;
}

function isBlockedIpv4(address) {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value))) {
    return true;
  }
  const [first, second, third] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && third === 0) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
}

function isBlockedIpv6(address) {
  const normalized = address.toLowerCase();
  if (normalized.startsWith("::ffff:")) {
    return isBlockedIpv4(normalized.slice("::ffff:".length));
  }
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/u.test(normalized) ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8:")
  );
}

function blockedAddressError() {
  return new WebToolError(
    "invalid_input",
    "The destination resolves to a local, private, link-local, or reserved address.",
  );
}

function ensureSuccessfulResponse(response) {
  if (response.ok) return;
  throw new WebToolError(
    "io_error",
    `The remote server returned HTTP ${response.status}.`,
    response.status === 408 ||
      response.status === 429 ||
      response.status >= 500,
  );
}

function isRedirect(status) {
  return [301, 302, 303, 307, 308].includes(status);
}

function mediaType(value) {
  return value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function isReadableContentType(value) {
  return (
    value.startsWith("text/") ||
    [
      "application/atom+xml",
      "application/json",
      "application/rss+xml",
      "application/xhtml+xml",
      "application/xml",
    ].includes(value) ||
    value.endsWith("+json") ||
    value.endsWith("+xml")
  );
}

function extractReadableText(source, contentType) {
  if (contentType === "application/json" || contentType.endsWith("+json")) {
    try {
      return { text: JSON.stringify(JSON.parse(source), null, 2) };
    } catch {
      return { text: normalizeText(source) };
    }
  }
  if (contentType === "text/html" || contentType === "application/xhtml+xml") {
    const titleMatch = source.match(/<title\b[^>]*>([\s\S]*?)<\/title>/iu);
    return {
      ...(titleMatch ? { title: normalizeText(stripHtml(titleMatch[1])) } : {}),
      text: htmlToText(source),
    };
  }
  return { text: normalizeText(source) };
}

function htmlToText(source) {
  return normalizeText(
    decodeHtml(
      source
        .replace(
          /<(?:script|style|noscript|svg|template)\b[\s\S]*?<\/(?:script|style|noscript|svg|template)>/giu,
          " ",
        )
        .replace(/<(?:br|hr)\b[^>]*>/giu, "\n")
        .replace(
          /<\/(?:article|blockquote|div|h[1-6]|li|main|p|pre|section|tr)>/giu,
          "\n",
        )
        .replace(/<[^>]+>/gu, " "),
    ),
  );
}

function parseDuckDuckGoResults(source) {
  const anchors = [];
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/giu;
  for (const match of source.matchAll(anchorPattern)) {
    const className = htmlAttribute(match[1], "class");
    if (!className.split(/\s+/u).includes("result__a")) continue;
    const href = htmlAttribute(match[1], "href");
    if (!href) continue;
    anchors.push({
      index: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
      title: normalizeText(stripHtml(match[2])),
      url: unwrapDuckDuckGoUrl(href),
    });
  }
  const results = [];
  const seen = new Set();
  for (const [index, anchor] of anchors.entries()) {
    if (!anchor.title || !anchor.url || seen.has(anchor.url)) continue;
    const nextIndex = anchors[index + 1]?.index ?? source.length;
    const afterAnchor = source.slice(anchor.end, nextIndex);
    const snippetMatch = afterAnchor.match(
      /<(?:a|div)\b[^>]*class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div)>/iu,
    );
    seen.add(anchor.url);
    results.push({
      title: anchor.title,
      url: anchor.url,
      snippet: snippetMatch ? normalizeText(stripHtml(snippetMatch[1])) : "",
    });
  }
  return results;
}

function htmlAttribute(attributes, name) {
  const match = attributes.match(
    new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "iu"),
  );
  return match?.[2] ? decodeHtml(match[2]) : "";
}

function unwrapDuckDuckGoUrl(value) {
  try {
    const url = new URL(value, DUCKDUCKGO_SEARCH_ENDPOINT);
    if (
      url.hostname.endsWith("duckduckgo.com") &&
      url.pathname === "/l/" &&
      url.searchParams.has("uddg")
    ) {
      return url.searchParams.get("uddg") ?? url.href;
    }
    return url.href;
  } catch {
    return "";
  }
}

function stripHtml(value) {
  return decodeHtml(value.replace(/<[^>]+>/gu, " "));
}

function decodeHtml(value) {
  return value.replace(
    /&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/giu,
    (entity, decimal, hexadecimal, name) => {
      if (decimal) return safeCodePoint(Number.parseInt(decimal, 10), entity);
      if (hexadecimal)
        return safeCodePoint(Number.parseInt(hexadecimal, 16), entity);
      return (
        {
          amp: "&",
          apos: "'",
          gt: ">",
          lt: "<",
          nbsp: " ",
          quot: '"',
        }[name.toLowerCase()] ?? entity
      );
    },
  );
}

function safeCodePoint(value, fallback) {
  try {
    return String.fromCodePoint(value);
  } catch {
    return fallback;
  }
}

function normalizeText(value) {
  return value
    .replace(/\r\n?/gu, "\n")
    .replace(/[\t\f\v ]+/gu, " ")
    .replace(/ *\n */gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function boundSearchOutput(base, results, maxResults, context) {
  const bounded = [];
  const limit = Math.min(maxResults, context.limits.maxEntries);
  for (const result of results.slice(0, limit)) {
    const candidate = { ...base, results: [...bounded, result] };
    if (
      Buffer.byteLength(JSON.stringify(candidate), "utf8") >
      context.limits.maxOutputBytes
    ) {
      break;
    }
    bounded.push(result);
  }
  const output = { ...base, results: bounded };
  if (
    Buffer.byteLength(JSON.stringify(output), "utf8") >
    context.limits.maxOutputBytes
  ) {
    return failure(
      "output_limit",
      "The web_search metadata exceeds the configured tool output limit.",
    );
  }
  return {
    ok: true,
    output,
    truncated: bounded.length < results.length || results.length > limit,
  };
}

function boundTextOutput(base, text, maxBytes) {
  const characters = Array.from(text);
  let low = 0;
  let high = characters.length;
  let accepted;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const output = { ...base, text: characters.slice(0, middle).join("") };
    if (Buffer.byteLength(JSON.stringify(output), "utf8") <= maxBytes) {
      accepted = output;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return accepted
    ? { output: accepted, truncated: accepted.text.length < text.length }
    : undefined;
}

function toolFailure(error, signal) {
  if (signal.aborted) return cancelled();
  if (error instanceof WebToolError) {
    return failure(error.code, error.message, error.retryable);
  }
  return failure(
    "io_error",
    "The web tool failed without exposing remote response details.",
    true,
  );
}

function failure(code, message, retryable = false) {
  return { ok: false, error: { code, message, retryable } };
}

function cancelled() {
  return failure("cancelled", "The web request was cancelled.");
}

class WebToolError extends Error {
  constructor(code, message, retryable = false, options) {
    super(message, options);
    this.name = "WebToolError";
    this.code = code;
    this.retryable = retryable;
  }
}
