# Web tools plugin

This optional plugin registers `web_search` and `web_fetch` through
Forge's normal plugin API. Both tools use the `network` risk, so the model must
receive an explicit approval for every request under both supported permission
profiles.

## Install as a user plugin

In the desktop app, open **Settings → Web research**, install the bundled plugin,
then explicitly enable it. Installation copies the application-supplied version into
`$FORGE_HOME/plugins/web-tools`; it never downloads code or overwrites an existing
plugin directory. Enablement updates the shared Forge user configuration, so it also
applies to the TUI. Project configuration cannot enable plugins. No plugin is enabled by default.

For a source checkout, install the locked workspace dependencies and prepare the
self-contained distribution (Readability 0.6.0, jsdom 26.1.0 and their runtime dependencies):

```bash
CI=true pnpm install --frozen-lockfile
node scripts/build-web-plugin.mjs
mkdir -p "${FORGE_HOME:-$HOME/.forge}/plugins"
cp -R apps/desktop/out/web-tools "${FORGE_HOME:-$HOME/.forge}/plugins/web-tools"
```

Only copy into a missing `web-tools` directory. Preserve or move an older/custom
installation yourself before replacing it. Copy the complete prepared directory,
including `node_modules` and dependency licenses, rather than just `index.mjs`.
The desktop build packages this same directory outside ASAR. Then enable it:

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
With `provider: "auto"`, absence of that variable selects DuckDuckGo's non-JavaScript HTML search.
Auto is selection at request time, never failover after an error.
The settings service selector stores only `{ "provider": "auto" }` (or `brave` /
`duckduckgo`) in the installed plugin's `settings.json`. It sets the tool's default;
an explicit tool input can choose another service. Tool results show requested and
actual services. No search API key is stored by this plugin or returned to the model.
Set `BRAVE_SEARCH_API_KEY` in the Agent launch environment before starting Forge;
settings shows only whether it is present. GUI launch environments may differ from
your terminal. Missing Brave credentials produce an explicit error.

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

## Extraction and sourced reports

Only HTML already retrieved by the controlled request path enters `new JSDOM`.
Scripts and remote-resource loading stay disabled; no browser, `fromURL`, or parser
network loader is used. Readability extracts articles; list pages, JavaScript-only
shells and parsing failures return bounded basic text with an explicit limitation.
No raw HTML is rendered. Static extraction cannot establish that dynamic content
was read.

Fetch results include requested/final URLs, access time, available publication time,
method (`readability`, `basic-text`, or `text`), and reading extent. The tool result's
`truncated` flag covers download, character and serialized-output limits. Search
results are marked `search-snippets`; they do not establish a page-body read. Failed
reads remain errors in the activity/history alongside the requested URL. Redirects
cannot forward Brave credentials to another origin; stalled response bodies time out.

The plugin contributes report instructions through the normal plugin API. Ask for a
Markdown report and, when needed, a `.md` file: ordinary workspace write tools handle
saving and approval; existing Markdown preview and Save as handle inspection/export.
Reports should link facts to consulted sources, distinguish snippet-only evidence and
failed reads, and include source access dates and reading limits. These instructions
are guidance to the model, not an automatic factual-correctness or citation validator.
Always inspect the cited evidence. Web content never grants execution authority.

Codex uses its own tools and sandbox. This plugin adds no Codex source fields and does
not establish Codex search availability or parity. See the current
[D11 acceptance record](https://github.com/jslee124/forge/blob/main/docs/DESKTOP_APP_TASKS.md)
for verified and unverified checks. [简体中文](README.zh-CN.md).
