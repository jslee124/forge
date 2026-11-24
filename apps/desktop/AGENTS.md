# Forge Desktop instructions

This directory holds the desktop app plus its component-scoped records. `pnpm
check:docs` requires every Markdown file here to be listed in the index below.

## Do not move

`INSTALL*.md` and `design-qa.md` are referenced by absolute `github.com` URLs from
already-published GitHub release notes and from packaged product help inside
shipped builds. Moving them breaks links that cannot be corrected retroactively.

`qa/` is the output directory of `scripts/acceptance-ui.mjs` (default
`qa/d12/ui`) and `scripts/acceptance-installed.mjs` (default `qa/d13`). It holds
regenerable acceptance evidence; keep the scripts and their default paths in sync.

## Records in this directory

| File | Status |
| --- | --- |
| [INSTALL.md](INSTALL.md) · [中文](INSTALL.zh-CN.md) | macOS installation, authentication, and update guide. Pinned. |
| [INSTALL-WINDOWS.md](INSTALL-WINDOWS.md) · [中文](INSTALL-WINDOWS.zh-CN.md) | Windows installation guide. Pinned. |
| [design-qa.md](design-qa.md) | Workbench design and accessibility QA record. Pinned. |
| [qa/d11-codex-report.md](qa/d11-codex-report.md) | D11 acceptance session report |
| [qa/d12/codex-report.md](qa/d12/codex-report.md) · [qa/d12/native-report.md](qa/d12/native-report.md) | D12 acceptance session reports |

Completed desktop design and workbench planning records have been archived to
`docs/history/desktop-workbench/` and `docs/zh-CN/history/desktop-workbench/`
([STUDIO_DESIGN](../../docs/history/desktop-workbench/STUDIO_DESIGN.md),
[WORKBENCH_DEVELOPMENT_PLAN](../../docs/history/desktop-workbench/WORKBENCH_DEVELOPMENT_PLAN.md),
[WORKBENCH_UX_PLAN](../../docs/history/desktop-workbench/WORKBENCH_UX_PLAN.md),
[DESKTOP_REFINEMENT_PLAN](../../docs/history/desktop-workbench/DESKTOP_REFINEMENT_PLAN.md),
[UPDATE_PLAN](../../docs/history/desktop-workbench/UPDATE_PLAN.md), and their
[zh-CN mirrors](../../docs/zh-CN/history/desktop-workbench/WORKBENCH_DEVELOPMENT_PLAN.md)).

Reviewed acceptance records for the released preview live with the release
evidence in `evals/reports/desktop-0.3.4-preview.2/` (D11, D12, D13, and the update
QA). The historical D01–D13 contract is
`docs/history/desktop-0.3.4-preview.2/DESKTOP_APP_TASKS.md`.

## Working rules

- Records here describe component work in progress; they are not shipped-behavior
  declarations. Source, tests, and `evals/reports/` establish what shipped.
- Keep the `.zh-CN.md` companion in sync when a record has one.
- Run `CI=true pnpm check:docs` after editing, and `CI=true pnpm check` for app code.
