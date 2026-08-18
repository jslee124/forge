# Forge v0.1 evaluation notes

The release evaluation ran on 2026-08-19 against Forge commit `65c0a51` using
`deepseek-v4-flash` with thinking enabled. The final release commit adds only
the reviewed report, trace artifacts, version metadata, and documentation.

Nine fresh trials produced seven passes:

- `config-merge`: 3/3
- `retry-cache`: 2/3
- `validation-bug`: 2/3

The canonical `validation-bug` task meets the required two-of-three live pass
gate. All nine trials remain in `report.json`, including failures.

Two runs ended as `denied` because the model requested a 120-second verification
timeout while the evaluation policy permitted only the declared 60-second
command. The external grader later showed that the rejected `retry-cache` patch
was correct; the rejected `validation-bug` patch did not pass its hidden grader.
These outcomes are evaluation data, not runner errors, and were not rerun or
removed to improve the score.

All nine JSONL traces were checked for schema validity, contiguous sequence
numbers, matching run IDs, and terminal status. A literal scan for the configured
DeepSeek API key found no match.
