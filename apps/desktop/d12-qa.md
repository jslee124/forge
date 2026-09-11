# D12 acceptance — 2026-09-11

Development acceptance on local macOS arm64. [中文](d12-qa.zh-CN.md).
This record separates live engine execution, offline failure injection and rendered UI.

## Workflow evidence

| Workflow | Native Forge | Codex | Shared inspection |
| --- | --- | --- | --- |
| Code change | Live DeepSeek v4 flash corrected subtraction to addition | Live authenticated Codex corrected the same fixture | FileService baseline review asserted modified sum.js |
| Local output | Live CSV generation preserved 001/002 and total 30 | Same live output assertions passed | CSV preview and byte-identical export passed |
| Sourced research | Live bundled web-tools search/fetch; Chinese report | Live Codex run produced English linked report | Report preview and export passed |

[Native observations](qa/d12/native.json), [Codex observations](qa/d12/codex.json),
[native report](qa/d12/native-report.md), [Codex report](qa/d12/codex-report.md).
These are application/FileService integration runs, not recordings of GUI model submission.
Native had five approvals; Codex had zero in this run, which does not imply blanket approval.
Codex report statements about fetching are model output: the bridge does not supply native
structured source fields or authoritative per-edit patches. No automatic citation verification
or complete cross-engine parity is claimed. Native search snippets and fetched bodies are distinct.
Original JSON preserves the pre-fix CSV EOF truncation flag; the final range regression and
rendered CSV check validate its correction without repeating the model calls.

## Failure evidence

All rows below passed as offline tests on this date; none represents a real provider outage
or an OS-killed production process. Paths are relative to the repository.

| Failure | Evidence | Expected boundary |
| --- | --- | --- |
| Agent crash | apps/desktop/src/main/agent-process.test.ts | Pending requests reject; listeners and active run are cleaned up |
| Cancellation/disconnect | apps/desktop/src/agent/run-service.test.ts | Deny pending approvals, interrupt sequence gaps, ignore late events |
| Missing/moved folder | apps/desktop/src/agent/workspace-session.test.ts | Reject missing/non-directory or changed root; preserve previous workspace |
| Storage denial | workspace-session.test.ts | Failed persistence does not replace the saved snapshot |
| Network failure | packages/plugin-api/src/web-tools.test.ts | Timeout/cancel/HTTP failure reported; no silent provider fallback |
| Corrupt history | workspace-session.test.ts | Bad records skipped in listing and rejected on resume |
| Concurrent writes/import conflicts | workspace-session.test.ts and apps/desktop/src/main/file-service.test.ts | Revision/lock checks; explicit rename/overwrite/cancel; preserve concurrent source edits |
| Unconfigured model/auth | apps/desktop/src/agent/application.test.ts and codex.test.ts | Missing credentials fail without tool effects; missing Codex never falls back to Forge |

## Rendered UI and fixes

The isolated Electron harness drives real main/preload/Agent IPC and file services with clearly
labelled offline session fixtures. [Ten captures and metrics](qa/d12/ui/ui.json) cover code,
CSV, research, settings in English and Simplified Chinese, plus 840 × 800 research layouts.
All ten captures were visually inspected; no document horizontal overflow. Review diffs use
internal scrolling. At narrow width the existing detail panel is hidden; widen the window to
inspect artifacts. These captures do not validate live streaming, approval dialogs, or every
failure message visually. Failure behavior is covered separately above.

Fixed stale preview/review state across task changes, including late asynchronous responses;
the harness checks state clearing. Added missing stable web error codes to localized operation
handling. Corrected PDF/CSV EOF range clamping so it does not falsely indicate omitted content;
partial ranges still report truncation. Added missing-model-credentials and range regressions.

## Reproduction and results

Run from repository root unless stated otherwise:

```sh
CI=true pnpm desktop:build
CI=true FORGE_D12_LIVE=1 FORGE_D12_EVIDENCE_DIR="$PWD/apps/desktop/qa/d12" pnpm exec vitest run apps/desktop/src/agent/acceptance-live.test.ts
# From apps/desktop, after building:
node scripts/acceptance-ui.mjs
```

Live acceptance: 1 file / 2 tests passed (170.77 s). It requires configured DeepSeek credentials,
Codex ChatGPT authentication and network access; creates/removes isolated workspaces.
UI acceptance: exit 0, ten captures. The runtime emits optional canvas/DOMMatrix/Path2D warnings;
this run did not render PDF pages, and no PDF GUI rendering claim follows.

Final checks: `CI=true pnpm check` passed (two existing informational lint notices);
focused eight files / 69 tests passed; `CI=true pnpm eval:deterministic` passed (13 files / 71 tests);
`CI=true pnpm package:verify` passed with a real packed CLI install (341291 bytes).
The focused set is application, workspace-session, run-service, codex, agent-process,
file-service, read-document and web-tools tests named above. `CI=true pnpm check:docs` passed (162 Markdown files, 610 local references).

Brave live credentials, full GUI failure-state matrix, PDF GUI rendering, installed GUI PATH/proxy,
x64, signing, notarization and publication remain unverified. D13 owns installer/environment
handoff. CLI packed-install verification is not desktop installer verification. No release or
publication was performed.
