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

Forge configures its shared HTTP transport from `HTTP_PROXY`, `HTTPS_PROXY`,
and `NO_PROXY` (lowercase aliases are also supported). Plugins using the global
`fetch` inherit that transport automatically. Only HTTP and HTTPS proxy URLs
are supported; use the HTTP or mixed port exposed by local proxy applications,
not a SOCKS-only port.

`web_search` uses the Brave Search API when `BRAVE_SEARCH_API_KEY` is present.
Without that variable it falls back to DuckDuckGo's non-JavaScript HTML search.
No search API key is stored by Forge or returned to the model.

## Implemented limits

- HTTP(S) only, with embedded URL credentials rejected.
- Standard ports 80 and 443 only.
- Local hostnames and private IP literals blocked before every request and
  redirect. Direct destinations are also resolved and checked against local,
  private, link-local, multicast, and common reserved ranges.
- When an explicit HTTP(S) proxy applies to a destination, the proxy owns DNS
  resolution so system-level Fake-IP answers are not mistaken for the remote
  server. `NO_PROXY` destinations retain the full direct-DNS checks.
- At most five fetch redirects, with every destination checked again.
- Fetch timeout is bounded to 1–20 seconds.
- At most 1 MiB is downloaded and at most 50,000 requested text characters are
  retained; Forge's smaller configured tool-output limit still wins.
- Only readable text, HTML, JSON, XML, RSS, and Atom MIME types are accepted.

The hostname check reduces accidental SSRF but is not an OS network sandbox and
cannot fully eliminate DNS rebinding between validation and connection. An
explicitly configured proxy is part of the trust boundary because it resolves
proxied hostnames. Review and trust plugins and proxy configuration as code, and
keep per-request approval enabled.
