# Forge evaluation report

- Generated: 2026-08-18T16:43:20.980Z
- Commit: `65c0a51a001005bd7610e14d5e885fdfbfe49d5d`
- Provider: deepseek
- Model: `deepseek-v4-flash`
- Thinking: enabled

| Task | Trials | Passed | Pass rate | Avg duration ms | Avg model steps | Avg tool calls | Avg tokens |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| config-merge | 3 | 3 | 100.0% | 13929 | 6 | 8 | 15085 |
| retry-cache | 3 | 2 | 66.7% | 61111 | 6 | 8 | 39993 |
| validation-bug | 3 | 2 | 66.7% | 44809 | 7 | 10 | 39509 |

Failures are retained as evaluation evidence. A run passes only when Forge
finishes successfully and both the fixture-owned and external hidden graders
pass.
