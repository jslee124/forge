# D11 web research acceptance

Development evidence, 2026-09-10–11. This is not release evidence or a search-quality
benchmark. D11 implementation is complete; the gaps below carry into D12/D13.

## Implemented boundaries

- Settings installs only the bundled web-tools 1.1.0 into the normal user plugin path.
  It preserves existing plugin directories and requires a separate explicit enable
  action. Shared user configuration retains unrelated fields; no default plugin is
  added. Project configuration cannot grant plugin enablement.
- Service configuration stores only the provider choice. Brave's key remains in the
  Agent launch environment. Auto selects a service before a request and never retries
  with another service after failure. Settings shows the default selection; actual
  requests/results remain visible in tool activity.
- CLI and desktop Agent initialize the same proxy-aware HTTP transport. Network tools
  still pass through core policy and require approval for every call.
- Controlled downloads feed Readability 0.6.0 / jsdom 26.1.0. No scripts or parser-driven
  resource requests run. Article extraction, basic-text fallback, access/publication
  times, requested/final URLs, reading extent and truncation are exposed. Parser bounds,
  redirect checks, cross-origin Brave credential protection, body timeouts and cancel
  remain explicit. Search download truncation is retained even with few parsed results.
- The normal plugin prompt contribution guides Markdown source attribution. The normal
  file tools save reports; existing previews/export remain shared. Guidance is not an
  automatic fact/citation validator. Codex receives no fabricated native source fields.

## Checks

Focused regression passed 54 tests across 8 files: web-tools, desktop application, web settings,
Codex bridge, HTTP dispatcher, core policy, configuration and source-URL validation. It covers separate
network approvals, denial before fetch, Markdown file output, install/enable/configure,
restart, unrelated-config preservation, invalid-setting repair, article/list/JS-shell
extraction, parser failure, output/download/redirect bounds, stalled bodies, cancellation,
proxy behavior and no automatic failover.

Commands:

```bash
CI=true pnpm check
CI=true pnpm exec vitest run apps/desktop/src/agent/web-plugin-settings.test.ts apps/desktop/src/agent/application.test.ts apps/desktop/src/agent/codex.test.ts packages/plugin-api/src/web-tools.test.ts apps/cli/src/http-dispatcher.test.ts packages/core/src/policy.test.ts packages/config/src/config.test.ts apps/desktop/src/shared/source-url.test.ts
CI=true pnpm eval:deterministic
CI=true pnpm check:docs
CI=true pnpm package:verify
CI=true pnpm desktop:build
node scripts/verify-web-plugin.mjs
```

The distribution copies 40 locked runtime dependencies and their package files/licenses
without flattening conflicting versions. The same prepared plugin is packaged outside
ASAR; Readability extraction was exercised using the packaged Electron executable
(Node 24.20.0, Electron 44.2.0), independently of repository dependency resolution for
the plugin. The test harness supplies the normal host `z` API.

An unsigned local arm64 `.app` was built with `electron-builder --dir --mac --publish
never --config.electronDist=node_modules/electron/dist`. The packaged Chinese settings
were inspected and exercised in a temporary Forge home: installation left enablement
off; explicit enablement checked it; selecting Brave updated the actual default service
while retaining the missing-key message. The initial crowded layout was subsequently
spaced with a dedicated settings grid. Final English/narrow-layout visual acceptance
belongs to D12; translation strings and production compilation are covered here.

Repository checks and docs/package verification passed; deterministic evaluation passed
13 files / 71 tests. Packaged Agent startup/shutdown smoke also passed. Source links
open through a fixed, sender-checked IPC entry that only accepts bounded HTTP(S) URLs
without embedded credentials; file/custom protocols remain blocked.

## Live observations

The initial 2026-09-10 checks encountered network failures and a Codex turn cancelled
at the 110-second bound. After resuming on 2026-09-11, the opt-in checks were rerun:

```bash
CI=true FORGE_D11_LIVE_WEB=1 FORGE_D11_LIVE_CODEX=1 pnpm exec vitest run apps/desktop/src/agent/web-research-live.test.ts
```

- DuckDuckGo returned three bounded results for `Mozilla Readability jsdom`, including
  the official repository. Results were explicitly marked search snippets and truncated.
- `https://example.com/` returned HTTP 200, the Example Domain body, requested/final URL,
  access time and the basic-text/static-content limitation; it was not truncated.
- Brave returned the expected missing-key error. No real Brave request, result quality
  or availability was verified.
- Codex completed and wrote a short Markdown report distinguishing search snippets and
  a retrieved page body. Its report links the official repository and Example Domain.
  The bridge does not expose structured search-source fields; the report is preserved
  as model output, not rewritten into fabricated native provenance. Search-tool detail
  parity and automatic citation validation are not claimed.

Evidence: [public observations](qa/d11-live.json) and
[Codex report](qa/d11-codex-report.md). Temporary workspaces/transcripts were removed;
no credentials or private user files were included. The service observation test can
pass while recording a service error; inspect its observation artifact, not only the
Vitest exit status. A live native-provider research-quality benchmark was not run.

No commit, signing, notarization, publication, x64 verification or installer release was
performed. D12 should extend dual-engine end-to-end/visual acceptance; D13 should verify
installed GUI launch environments, including proxy and Brave-key provisioning.
