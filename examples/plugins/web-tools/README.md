# Web tools plugin

This dependency-free example registers `web_search` and `web_fetch` through
Forge's normal plugin API. Both tools use the `network` risk, so the model must
receive an explicit approval for every request under both supported permission
profiles.

## Install as a user plugin

Copy the directory and enable it in the user configuration:

```bash
mkdir -p "${FORGE_HOME:-$HOME/.forge}/plugins"
cp -R examples/plugins/web-tools "${FORGE_HOME:-$HOME/.forge}/plugins/web-tools"
```

```json
{
  "schemaVersion": 1,
  "plugins": {
    "enabled": ["web-tools"]
  }
}
```

Restart `forge`, confirm that the blue startup frame lists `web-tools`, and
ask the Forge Engine to search or fetch a public page. The Codex Engine owns a
separate tool runtime and does not use Forge plugins.

`web_search` uses the Brave Search API when `BRAVE_SEARCH_API_KEY` is present.
Without that variable it falls back to DuckDuckGo's non-JavaScript HTML search.
No search API key is stored by Forge or returned to the model.

## Implemented limits

- HTTP(S) only, with embedded URL credentials rejected.
- Standard ports 80 and 443 only.
- Local, private, link-local, multicast, and common reserved IP ranges blocked
  before each request and redirect.
- At most five fetch redirects, with every destination checked again.
- Fetch timeout is bounded to 1–20 seconds.
- At most 1 MiB is downloaded and at most 50,000 requested text characters are
  retained; Forge's smaller configured tool-output limit still wins.
- Only readable text, HTML, JSON, XML, RSS, and Atom MIME types are accepted.

The hostname check reduces accidental SSRF but is not an OS network sandbox and
cannot fully eliminate DNS rebinding between validation and connection. Review
and trust plugins as code, and keep per-request approval enabled.
