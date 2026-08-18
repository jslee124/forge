# Smoke trial history

## 2026-08-19 — commit `bffa0ba`

The first `validation-bug` smoke trial produced a correct patch that passed both
the fixture-owned and external hidden graders. The run itself was correctly
classified as denied because the model proposed `npm test` while the evaluation
policy allowed only the specified `pnpm test` command.

This exposed two evaluation-harness defects before the release trials:

- The exact allowed command was documented but not included in the model task.
- Approval rejection was not included in the report's denied-action count.

Both defects were corrected before restarting release evaluation. This smoke
trial is not counted as a release trial because it evaluated the superseded
runner commit.
