# Forge Desktop Productization PRD

[简体中文](../zh-CN/development/DESKTOP_PRODUCT_PRD.md) · [Implementation](DESKTOP_PRODUCT_IMPLEMENTATION.md) · [Roadmap](ROADMAP.md) · [Documentation index](../README.md)

Updated: 2026-10-26. Status: development contract, incremental implementation in progress. “v1” means
this productization scope, not a release version or an implemented capability.
Current behavior remains defined by source, tests, and recorded acceptance.

## 1. Positioning and goal

Forge Desktop v1 helps developers understand an existing local repository, make a
bounded change, run verification, and inspect the result. Its central promise is
that users can tell what the Agent is doing, when a decision is required, what
actually changed, what was checked, and how to proceed after interruption.

This proposes moving from an inspectable Agent engineering tool toward a desktop
product that users can operate independently. The current
[product definition](../product/concepts/PRODUCT.md) continues to describe the
existing product; this proposal does not rewrite it retrospectively.

The primary user can read code, review diffs, and assess command risk. v1 is not an
autonomous app generator for users without development knowledge. First use must
not require understanding core, IPC, canonical history, or token chunks.

## 2. Problem and evidence limits

On 2026-10-25, a macOS Electron development-window walkthrough covered approvals,
expanded activity, termination, recovery in the same conversation, a completed
answer, and activity inspection. Observations:

| Observation | User consequence | Responsible layers |
| --- | --- | --- |
| Approval repeats a command preview and JSON | Action, target, and authority are hard to identify | Application protocol, Desktop |
| Eight read-only grep/sed requests were approved during takeover | Routine investigation requires continuous supervision | Tools, model behavior, policy |
| Activity exposes fragments and a count stuck at 200 | Actual operation count is unclear; expansion displaces approval | Event projection, Desktop |
| Model-step budget ends without the requested advice | Investigation does not converge on a useful result | Runtime, task strategy |
| Internal English outcome text appears as an answer | System state and answers are confused | History projection, error presentation |
| A manually written “answer from existing information” prompt recovers | Recovery requires prompt-writing knowledge | Application orchestration, Desktop |
| Completion is weakly signaled; an activity entry contains only a period | Completion and inspection are difficult | Desktop, semantic aggregation |

This is qualitative evidence from one development-window journey, not an overall
success rate, installed-app result, Windows result, or release claim. Current
source pointers are in the [implementation baseline](DESKTOP_PRODUCT_IMPLEMENTATION.md#2-current-source-baseline).
Earlier automated desktop acceptance does not replace this product acceptance.

## 3. Scope and non-goals

### 3.1 Required v1 scope

1. Ask questions, investigate, and explain code in one selected repository.
2. Make bounded file changes and present actual diffs and verification results.
3. Handle repeated approvals, progress, stop, denial, model errors, exhausted
   budgets, and explicit recovery.
4. Support long answers and outputs, message actions, activity inspection, and
   historical reading after reopening the app.
5. Establish one native-engine/model combination as the first fully accepted path
   using the fixed task corpus.
6. Cover Chinese/English, light/dark themes, keyboard access, Chinese IME, wide
   desktop windows, and narrow windows.

Existing Codex, model settings, plugins, and research capabilities remain
accessible with their own capability and acceptance descriptions. v1 reduces
default advanced-control density without removing compatibility or claiming
engine equivalence. Initial live manual acceptance starts on macOS; a Windows
product-release claim requires its own acceptance evidence.

### 3.2 Non-goals

- Autonomous commit, push, publication, deployment, or dependency installation;
  existing explicit authorization remains required.
- Multi-agent orchestration, cloud collaboration, background tasks, cross-machine
  sync, or a new general plugin marketplace.
- Changing runtime framework for its own sake, or requiring a new database or
  public package for this work.
- Automatically restoring pending effects, approvals, processes, or provider
  continuation.
- Allowing commands based on executable names. v1 focuses on allow-once and deny.
- Describing workspace policy or `shell: false` as operating-system isolation.

## 4. Core journeys

### 4.1 Understand a repository

Select repository → ask → see the resources being read/searched → receive a
grounded explanation → copy or ask a follow-up. Ordinary dedicated workspace
reads do not require process approval. Explain missing evidence; do not conduct
unbounded investigation for a simple question.

### 4.2 Complete a small change

Describe goal → clarify scope when necessary → investigate → approve required
actions → edit → verify → inspect delivery summary and diff. Distinguish actual
changes, commands run, their results, and unchecked items. A model finishing its
answer does not prove user-goal completion. Other sources' workspace changes must
not be attributed to Forge.

### 4.3 Approve or deny

Show a stable approval area immediately: action summary, target/directory,
authority scope, and full-command access. Initially focus Deny; Tab reaches Allow
once. Preserve the decision after submission. Long details do not displace the
buttons. Denial need not terminate the whole task: return the denial to the Agent
so it can find permitted alternatives, without disguising and repeating the same
denied action. Explain when no permitted path remains.

### 4.4 Fail and recover

Show the specific cause, completed and remaining work, and available recovery
actions. Recovery creates a linked new run after an explicit choice, reloads
configuration, checks current workspace state, and obtains fresh authorization.
“Summarize existing information” uses no tools; “Continue” can require new
approvals; “Edit and retry” restores an editable draft first.

## 5. Requirements and acceptance

R identifiers connect implementation tasks, tests, and product acceptance.

| ID | Requirement | Observable acceptance |
| --- | --- | --- |
| R01 | Clear task entry | Repository, effective model, and policy are inspectable; configuration errors precede tool execution and retain input |
| R02 | Stable run state | Distinguish preparation, model response, tool execution, approval wait, finalization, and termination; show only evidenced phases |
| R03 | Understandable approvals | Show action, resource, directory, scope, and full command; JSON starts collapsed; distinguish Deny and Allow once |
| R04 | Correct approval lifecycle | Bind to run/action; reject duplicate, expired, and cancelled decisions; preserve individual requests |
| R05 | Readable activity | One tool call per item; merge continuous reasoning; counts represent operations rather than chunks; show truncation and missing data |
| R06 | Efficient investigation tools | Line-range reads and contextual search avoid process calls for ordinary partial reads while preserving boundaries and limits |
| R07 | Controlled convergence | Respect explicit limits and reserve finalization within them; stop evidenced no-progress loops without imposing default total-count ceilings |
| R08 | Specific termination | Preserve completion, cancellation, terminal denial, model/tool/context budgets, provider/tool/storage failures |
| R09 | Actionable recovery | Offer summarize/continue/edit-retry only when supported; link new runs; never silently replay effects |
| R10 | Usable conversation | Enter sends, Shift+Enter inserts newline, IME does not submit; submitted text and next draft are separate; failed input can be recovered |
| R11 | Truthful delivery | Show actual changes, commands/results, and not-run/failed/unknown verification; narrative is not execution evidence |
| R12 | Long content and message actions | Follow output at bottom, preserve upward reading, offer jump-to-latest; expose copy, linked activity, and explicit retry |
| R13 | History and abnormal exit | Inspect finished runs; after abnormal exit show interruption and unknown effects without restoring approvals or rerunning |
| R14 | Compatibility and honest capabilities | Preserve CLI, gateway, and old sessions; show unavailable Codex progress/budget as unknown or not applicable |
| R15 | Accessibility and performance | Reach core actions by keyboard; visible focus; announce phases rather than chunks; reduced motion; no per-chunk activity DOM |

### 5.1 Approval hierarchy

- Title: for example, “Request to execute a command.” Use a static waiting icon
  rather than an execution spinner while waiting for a decision.
- Summary: for example, “Inspect layout styles in studio.css.” It assists
  understanding and does not replace the command or risk assessment.
- Scope: directory, resource, allow-once boundary; risk flags come from tools and
  policy, not model claims.
- Details: full command and arguments; raw protocol data belongs in diagnostics.
- Footer: Deny / Allow once. Keep buttons stable relative to the composer; only
  the details area scrolls within a height limit.
- After decision: collapse to allowed/denied. Successful authorization and
  successful execution remain distinct states.

### 5.2 Activity and answers

The conversation shows the current action and a compact run summary; the panel
shows a detailed view of the same activity data. Label provider-returned reasoning
and merge it; never fabricate it or use it as authority or evidence of progress.
Associate activity, failures, and answers with runs. Separate context diagnostics
from user activity instead of filling the default view with internal fields.
After completion show the reason, elapsed time, and result entry points. Unknown
cost and usage remain unknown.

### 5.3 Budget and recovery

Ordinary native tasks have no default total model-step or tool-call ceiling.
Explicit numeric limits remain hard limits; reserve a tool-free finalization
opportunity within them. Preserve cancellation, command timeouts, context/output
bounds and conservative no-progress guards. Ordinary failed tests do not alone
establish a loop. Uncapped execution is not a monetary spending cap.

If an explicit limit is too small or the model lacks finalization support, explain
it and use a deterministic execution-facts summary. Limit/no-progress summaries
remain partial results rather than successful tasks. Facts remain available if
network or context limits prevent model summarization. Before continuing, show
effective limits (including no fixed cap) and authorization rules. Summarization
does not override denial, cancellation, or process disconnection. See the
[2026-10-28 implementation and verification](DESKTOP_PRODUCT_IMPLEMENTATION.md#13-optional-native-task-ceilings-2026-10-28).

### 5.4 Repair verification

For nontrivial authorized fixes, map the requested behavior and preservation
constraints to expected outcomes and meaningful checks before testing. Separate
observed legacy behavior from a specified requirement; disclose consequential
ambiguities. Report reproduced failure, passing verification and remaining
requirements separately. Model guidance and self-authored tests are supporting
evidence; a red/green loop alone cannot establish goal correctness.

## 6. Visual and interaction constraints

Reuse existing muted themes, fonts, icons, and design variables. Prioritize
semantics and interaction rather than a complete visual replacement. Approval,
running, failure, and completion share spacing, typography, and status patterns.
Separate prose from technical details; communicate status with text and icons as
well as color. Cover 1100×728 and 840px-wide windows, open workbench, collapsed
sidebar, long model names, and long commands. Check 200% zoom, keyboard focus,
Chinese composition, reduced motion, and phase announcements with a screen reader.

## 7. Validation and measures

These are proposed release gates, not achieved results. M0 freezes the corpus and
rubric before baseline measurement; do not replace failures or lower gates after
seeing results. Retain task version, code revision, engine/model, configuration,
raw traces or explicit absence, screen evidence, graders, and human assessments.

Use 24 fixed tasks: six repository explanations, six bounded edits, six diagnosis
and verification tasks, and six recovery tasks. Define inputs, allowed effects,
required checks, and success in advance. Correct denial/preservation can count as
success in negative cases. Report two independent rounds separately.

| Measure | Definition | v1 gate |
| --- | --- | --- |
| Task success | Tasks meeting both grader and human criteria / 24 | At least 22/24 in each round; all critical authorization/recovery cases pass |
| Independent completion | Five target users each attempt three fixed tasks without developer coaching; completions / 15 | At least 12/15; retain individual failure causes |
| Approval burden | Requests, user decisions, and request reasons per task | Zero approvals for dedicated workspace reads; process approvals follow actual policy without an unsafe reduction target |
| Repeated investigation | Identical reads/searches with unchanged resource versions, separating justified rereads | No unbounded retry; fixed loop cases converge or stop |
| Latency | First meaningful feedback, first answer, total duration; separate approval waiting | Report tasks and p50/p95 against baseline; never skip verification to improve speed |
| Recovery | Injected cases with identifiable causes, preserved work, and correct recovery / all injected cases | All deterministic contract cases pass; no unauthorized replay |
| Readability/performance | Fixed stress cases with 10,000 deltas, long answers/commands, and 500 tool actions | No 10,000 activity rows; input and stop remain usable; no silent truncation |

Record deterministic checks, external-model tasks, user trials, installed-app
acceptance, and release assets separately. Each claimed OS/architecture needs its
own install/start evidence; a macOS development window does not prove Windows.

## 8. Stages and definition of done

| Stage | Runnable deliverable | Release condition |
| --- | --- | --- |
| M0 | Baseline tasks, reproductions, boundaries, metric definitions | No product-completion claim |
| M1 | Structured events, reasons, persistence, message projection | New/old data and cross-entrypoint contract tests pass |
| M2 | Partial reads, contextual search, convergence, tool-free summaries | Policy unchanged; budget/context/provider tests pass |
| M3 | Approval, activity, conversation, delivery, recovery flow | Bilingual/theme/keyboard matrix passes; real journey demonstrable |
| M4 | Fixed corpus, user trials, installed acceptance, candidate report | Propose a product release only after these and section 7 gates pass |

Detailed tasks and dependencies are in the
[implementation plan](DESKTOP_PRODUCT_IMPLEMENTATION.md#10-tasks-and-dependencies).
Full stage acceptance remains pending; incremental implementation and pilot results
are tracked in the implementation plan. No calendar estimate or unselected release tag is promised.

## 9. Risks and tradeoffs

- Models, prompts, and tools jointly affect convergence. Compare fixed tasks;
  one failure does not establish that a model or framework is unsuitable.
- Persistence increases local sensitive data: redact and bound output, preserve
  local permissions, and add no default telemetry.
- Collapsing diagnostics can reduce transparency: retain discoverable details
  and explicit truncation.
- Reserved finalization reduces investigation steps: evaluate delivery under a
  fixed total budget and retain configuration/rollback paths.
- Browsing history during execution requires separate viewed and active sessions;
  v1 does not permit a second concurrent writing task.
- Do not put proposed capabilities into packaged product help before acceptance.
