import { randomUUID } from "node:crypto";
import { session } from "electron";
import { validateUpdateUrl } from "./update-service.js";

/** Electron fetch cancels manual redirects instead of returning their response.
 * A private, nonpersistent session validates every hop BEFORE Chromium sends it.
 * The body remains streamed by Chromium, with proxy support and backpressure.
 */
export function createUpdateFetch(): typeof fetch {
  const isolated = session.fromPartition(`forge-update-${randomUUID()}`, {
    cache: false,
  });
  let active = false;
  let asset = false;
  let requests = 0;
  let rejected: Error | undefined;
  isolated.webRequest.onBeforeRequest((details, callback) => {
    try {
      if (!active || requests >= 5)
        throw new Error("Too many update redirects");
      validateUpdateUrl(details.url, asset, requests > 0);
      requests++;
      callback({});
    } catch (error) {
      rejected =
        error instanceof Error ? error : new Error("Unsafe update redirect");
      callback({ cancel: true });
    }
  });
  return async (input, init) => {
    if (active) throw new Error("Concurrent update network request");
    const url = String(input);
    asset = new URL(url).hostname !== "api.github.com";
    validateUpdateUrl(url, asset);
    requests = 0;
    rejected = undefined;
    active = true;
    try {
      return await isolated.fetch(url, {
        ...init,
        redirect: "follow",
        credentials: "omit",
        cache: "no-store",
        bypassCustomProtocolHandlers: true,
      });
    } catch (error) {
      throw rejected ?? error;
    } finally {
      active = false;
    }
  };
}
