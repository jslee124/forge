# ADR-0005: Review Desktop recovery before creating a linked new run

[Documentation index](../README.md) · [Product implementation](../development/DESKTOP_PRODUCT_IMPLEMENTATION.md)

## Status

Accepted on 2026-10-25 for native Desktop recovery. Extends
[ADR-0003](0003-desktop-durable-run-records.md) and
[ADR-0004](0004-reserved-desktop-finalization.md).

## Context

A partial answer, denial, or interrupted run needs an explicit next action.
Replaying a stored tool call, restoring a grant, or silently increasing a budget
would turn historical evidence into execution authority. A retry must also avoid
overwriting an unrelated draft without a deliberate choice.

## Decision

- The application prepares bounded historical facts from a finished run in the
  current session. Source records are context only. Unknown effects remain
  unknown, pending actions are not executed, and omissions are disclosed.
- Desktop reviews source, prompt, current native model and effort, budget, and
  permission profile. Preparation creates one volatile opaque token, bound to
  session revision, source fingerprint, selection, and effective configuration.
  Tokens are neither persisted nor authority carried by historical records.
- On submission, the host rechecks those bindings under session and workspace
  leases, consumes the token before admission, and starts a new run ID. It uses
  the checked configuration snapshot for execution. Settings changes require
  another review. New/create/resume/workspace changes and normal starts clear the
  preparation. Reusing a consumed token fails before a provider call.
- Summarize uses at most one logical model step and zero tools, with bounded
  redacted source facts. It bypasses project instructions, Skills and plugins;
  neither source continuation nor grants enter this path. Unsupported/unavailable
  adapters or failed generation use deterministic recorded facts without another
  attempt. Storage admission failure happens before a provider call.
- A summary remains partial and cannot certify task success. Its source link is
  persisted alongside completion and shown in history. To continue or retry the
  original task from a summary, select the original source first.
- Continue starts an ordinary native run with fresh limits, policy, and approvals;
  its prompt requires inspecting current state rather than replaying uncertain
  effects or repeating a denied action unchanged. Existing session canonical
  history remains context; provider continuation and grants are not restored.
- Retry first loads the original canonical user prompt into an editable draft.
  Replacing an existing draft requires confirmation; execution needs a separate
  send. Reviewed model and permission settings remain pinned until unlinking.
  Continue and summarize preserve the next draft.

## Limits

This increment supports native sources only. Continue/retry need the original
canonical user message; a preview from a crash before canonical persistence is
insufficient. Tokens disappear on process restart. The summary budget counts
logical runtime steps, not adapter-owned bounded HTTP retries. Recorded tool
success is not proof of task success or attribution of workspace changes.
A richer delivery model, live-model quality, concurrent-session browsing,
installed-app acceptance, and release gates remain independent work.
