# Forge v0.3.3 live provider resume smoke

[简体中文](LIVE_PROVIDER_RESUME_SMOKE.zh-CN.md)

Evidence date: 2026-08-30
Candidate base commit: `782de378716961c34bce630a90038d8a383612a9`

## Scope and safety boundary

The smoke used an isolated temporary Forge home and workspace, a synthetic
token file, strict read-only prompts, and bounded model settings. The temporary
Forge home contained a copied credential file only for the duration of the
trial. No OpenAI API key or OpenAI API request was used.

Only the structural summary below is checked in. Raw sessions, traces,
credentials, terminal recordings, and the synthetic token are not retained in
the repository. A credential-pattern scan of the generated DeepSeek session and
trace files found zero matching files.

## DeepSeek Forge Engine

Configuration:

- Provider/model: DeepSeek `deepseek-v4-flash`
- Thinking: disabled; effort label: low
- Limits: 3 model steps, 3 tool calls, 4 KiB tool output
- Persistence: session schema v3, `historyFidelity: structured`

Observed result:

1. A fresh interactive process proposed and completed one `read_file` call for
   the synthetic workspace token.
2. The first answer returned the exact token.
3. A new `forge resume --last` process restored the same session.
4. The resumed prompt explicitly prohibited tool use. The second run emitted no
   tool events and returned the exact prior token from restored history.
5. The durable session contained two run IDs and six canonical messages:
   user, assistant tool call, paired tool result, assistant answer, resumed
   user, resumed assistant answer. Both runs completed successfully.

Result: **pass** for native DeepSeek tool-call, persistence, paired canonical
history, and cross-process resume.

## Codex Engine through ChatGPT subscription

Configuration:

- Engine/model: Codex Engine `gpt-5.6-luna`
- Reasoning effort: low
- Authentication: existing ChatGPT subscription
- OpenAI API: not used
- Persistence: session schema v3, `historyFidelity: structured`

Observed result:

1. A fresh interactive Codex Engine process read the synthetic workspace token
   through Codex-managed command activity and returned it exactly.
2. A new `forge resume --last` process rendered the prior user/assistant turn.
3. The resumed wrapper reported two retained canonical messages and zero
   omitted messages.
4. The resumed prompt prohibited file reads and tool calls. Luna returned the
   exact prior token from restored conversation context.
5. The durable session contained two run IDs and four canonical messages. Both
   turns completed successfully; the first turn's bounded reasoning summary was
   retained separately.

Codex-managed internal tool activity is not represented as a Forge canonical
tool call/result pair. Forge persists the model-visible completed turn and
reasoning summary without restoring Codex process or tool authority.

Result: **pass** for Luna Codex Engine completed-turn persistence and
cross-process resume through ChatGPT subscription.

## Remaining live boundary

Native OpenAI API was intentionally not tested because no OpenAI API key is
available and the user explicitly prohibited that path. A configured
OpenAI-compatible route was not called. If compatible-route live behavior is a
stable-release claim, run one separately authorized bounded smoke before
tagging.
