# ADR-0002: Separate Desktop run presentation from model history and transport fragments

[Documentation index](../README.md) · [Product PRD](../development/DESKTOP_PRODUCT_PRD.md) · [Implementation plan](../development/DESKTOP_PRODUCT_IMPLEMENTATION.md)

## Status

Accepted for the first productization increment on 2026-10-25. This records the
implemented presentation/transport boundary, not completion of the product plan.
Durable product records and reserved-budget finalization remain pending work.

## Context

A desktop walkthrough exposed reasoning fragments as individual activity rows,
repeated process approvals as unstructured text, and model-step exhaustion as a
generic failure. Internal outcome text in canonical history was presented as an
ordinary answer. Fixing styles alone would preserve these ambiguities.

Core already provides action identities, policy decisions, approval descriptors,
and distinct terminal outcomes. Presentation must retain these facts without
changing execution authority or turning persisted context into approval.

## Decision

- Keep semantic projection in the private application package. Core owns policy,
  limits, tools, and cancellation.
- Version Desktop run-event envelopes as v2 and verify the Agent version at
  startup. Preserve run/request/session identity and contiguous sequence checks.
  A malformed active-run event interrupts rather than leaving the task waiting.
- Send native tool updates by action ID and structured approval fields, including
  complete bounded input. Approval remains allow-once/deny; responses must match
  approval and action. Display metadata never grants authority.
- Coalesce adjacent text before sequence allocation. Merge provider reasoning
  into bounded continuous segments, count operations rather than fragments, and
  label omitted content.
- Preserve run outcomes/reasons and observed counters. Omit unavailable Codex
  counters rather than displaying synthetic zeros.
- Project canonical history without mutating it. Classify generated outcomes
  using structured identity, reserved message position, recorded run membership,
  and the known generated format together. Never strip user or uncorroborated
  legacy text using a prefix match. Tool-only messages do not create empty avatars.
- Separate next drafts from submitted input; termination cannot overwrite a newer
  draft.

## Alternatives considered

- Renderer parsing of JSON/English logs loses reliable identity and reason fidelity.
- Removing canonical outcomes would harm model recovery and session fidelity.
- Allowing familiar command names cannot establish safe effects or scope.
- A new runtime framework is unnecessary for these observed contract defects.

## Consequences

Desktop main, Agent, and renderer must be rebuilt together. CLI/gateway retain
core-event contracts. Existing sessions stay v3 and readable; uncorroborated
legacy content stays visible. This increment does not create durable activity
records, restore effects, reserve model budget, add reusable grants, or establish
installed/release acceptance. Those remain separate tracked work.
