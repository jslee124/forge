# D03 visual QA

Date: 2026-09-07

## Evidence

- Source visual truth: `docs/assets/desktop/task-workbench.png` (1486 × 1027 px).
- Implementation: production renderer at `http://127.0.0.1:4173/`.
- Combined comparison: `http://127.0.0.1:4175/` displayed the source and implementation side by side from `/private/tmp/forge-d03-qa/index.html`.
- Comparison state: Simplified Chinese, running task, results panel open, light theme.
- Main viewport: 1486 × 1027 CSS px at device pixel ratio 1. Source and implementation were both normalized to 594 × 411 px (scale 0.4) in the combined comparison.
- Additional browser-rendered evidence: English settings and home; approval-required task; failed task; stopped task; generated task; retained per-task draft; engine selection; 840 × 800 narrow-window layout; visible keyboard focus.
- Primary interactions tested: task switching, draft retention, panel close/open, stop, approval display, failure display, folder selection, simulated task creation, locale change, engine selection, and keyboard Tab focus.
- Browser console: the initial preview exposed one preload-only API error. A guarded browser-preview fallback fixed it; subsequent current-asset captures added no error or warning.

## Full-view comparison

The implementation preserves the reference's three-part hierarchy: task/project navigation on the left, a borderless flowing conversation in the center, and a collapsible result/change panel on the right. The user prompt remains a light, right-aligned bubble; assistant prose has no avatar or enclosing bubble. Header, activity, composer, and result panel align with the reference's density and light restrained surfaces.

Intentional differences are within the contract: the repository Forge wordmark replaces the generated mock icon, only the three required simulated workflows are listed, and a 28 px black prototype banner continuously states that no real action is taking place. Semantic requirements take precedence over the mock's sample task count and content.

Focused regions were checked separately because controls and copy were too small in the scaled full-view comparison: composer selectors and stop button, approval actions, failure/retry notice, settings language select, Markdown table and highlighted TSX block, narrow sidebar, and keyboard focus ring.

## Required fidelity surfaces

- Fonts and typography: system sans-serif and Chinese platform fallbacks match the reference's neutral UI character. Heading and body weights remain readable in both locales; long English sidebar labels truncate without changing the shared layout.
- Spacing and layout rhythm: 232 px desktop navigation, a flexible conversation column, and a roughly 31% result panel reproduce the reference proportions. Conversation copy uses a readable 760 px maximum width; the composer stays anchored at the bottom. At the narrow breakpoint the sidebar compacts and the result panel becomes a closable overlay.
- Colors and tokens: white/light-gray surfaces, restrained borders, blue active state, green completion, amber approval, and red failure all use shared CSS variables. Statuses include text/icons and do not rely on color alone.
- Image and icon fidelity: the repository's existing Forge SVG is used rather than reconstructed art. Phosphor supplies interface icons; no emoji, CSS drawings, or placeholder assets are used.
- Copy and content: interface navigation, controls, statuses, errors, approvals, settings, and help are covered in Simplified Chinese and English. Historical task prompts and drafts do not change when the interface locale changes.

## Comparison history

1. Initial browser capture was blank because the normal Electron preload API is absent in a standalone renderer preview. The app now guards that preview-only boundary while Electron continues to use the real health bridge.
2. The first visible capture showed a broken wordmark because Vite inlined the SVG while the CSP omitted `data:` images. The asset was moved beside the renderer and `img-src 'self' data:` was added; the next desktop capture rendered the official wordmark.
3. The first narrow capture cropped the wide wordmark to `>FO`. The narrow breakpoint now scales the complete asset into the compact sidebar instead of cropping it.
4. Post-fix desktop, locale, state, interaction, focus, and overflow checks found no remaining P0, P1, or P2 issue.

## Findings

No actionable P0, P1, or P2 visual differences remain.

## Follow-up polish

- P3: The always-visible simulation banner shifts the mock's vertical geometry by 28 px, but it is retained because accurate prototype disclosure is more important than pixel-identical top spacing.
- P3: The generated reference contains more recent-task rows and denser sample prose; D03 keeps only the three acceptance workflows and representative Markdown content.

## Final result

final result: passed
