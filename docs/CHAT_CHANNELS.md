# Chat Channels (Experimental)

[简体中文](zh-CN/CHAT_CHANNELS.md) · [Documentation index](README.md)

The development checkout provides a foreground Telegram gateway for one owner,
one private conversation, and one workspace. It reuses the Forge native engine,
model configuration, tools, and persisted sessions. This is an unreleased source
feature targeting 0.4.0; live Telegram acceptance and publication remain pending.
Codex engine, groups, voice, attachments, background service installation, and
Desktop gateway settings are not supported.

## Configure locally

Configure a working native model using [Getting started](GETTING_STARTED.md).
Create a Telegram bot through [BotFather](https://t.me/BotFather), obtain your own
numeric Telegram user ID through a trusted method, and supply the bot token in the
`FORGE_TELEGRAM_BOT_TOKEN` environment variable. Keep its value out of shell history,
repository files, chat messages, and diagnostic reports.

From the development checkout (replace the owner and workspace placeholders):

```bash
pnpm forge gateway setup telegram --owner <numeric-user-id> --workspace <absolute-workspace-path> --alias forge --permission-profile safe --accept-remote-disclosure
pnpm forge gateway run
```

`--accept-remote-disclosure` acknowledges that task text and selected results travel
through Telegram. The configured workspace is the canonical project root discovered
from the supplied directory. Only that numeric owner can invoke this bot in a private
chat. There is no first-sender pairing or public access. The gateway refuses an existing
webhook; remove that configuration locally before choosing long polling.

Configuration is stored in `FORGE_HOME/gateway/config.json`; state and pending replies
are in `FORGE_HOME/gateway/state.json`. Without a `FORGE_HOME` override, Forge uses
`~/.forge`. The token remains in the environment. Sessions remain under the same Forge
home's `sessions/` directory. Use a durable home directory for retained conversations;
a temporary directory is for disposable testing and may be cleaned by the OS.
Setup refuses to overwrite an existing configuration. Stop the gateway before local
configuration changes. Changing the owner, workspace, profile, or bot invalidates the
state binding: archive the old gateway state locally before using the new binding;
old sessions stay on disk but are not automatically attached to the new owner.

Run the gateway on the machine containing the repository. It needs outbound access to
Telegram and the model provider. Existing HTTP(S) proxy environment settings apply.
Long polling needs no public inbound port. The process must remain running and the
host awake; closing Desktop does not stop this separate foreground process.

## Use the private chat

| Input | Result |
| --- | --- |
| Text | Start a task if the workspace and gateway are idle |
| `/help` | Show supported commands |
| `/status` | Show task state and pending delivery count without a model request |
| `/new` | Start a fresh conversation when idle; retain previous records |
| `/cancel` | Request cancellation and invalidate pending approvals |

Busy messages are rejected rather than queued. Forwarded, edited, bot-authored,
non-private and attachment messages cannot start tasks. Task text older than five
minutes or larger than 16 KiB is rejected. Replies contain a task ID; final text is
bounded and can be split/truncated, with a local session reference for inspection.
That reference is not a remote file link. Hidden reasoning and raw tool traces are
not sent. Redaction covers configured secrets and known patterns; it cannot discover
every private fact in repository output.

Remote non-read actions require individual approval even with `workspace-write`.
Buttons allow one action or deny it. Approvals expire after five minutes (or sooner
when cancelled or the 30-minute overall task deadline expires). An action that cannot
be shown completely within the approval message budget, or whose description requires
secret redaction, is denied. Core/plugin denials remain final. Cancelling does not
undo previous effects; status remains cancelling until the runner settles.

Cooperating native and Codex runs from CLI, Desktop and Gateway acquire a shared
host-local workspace lease. Competing runs return busy, including read-only runs.
Other programs/editors are not locked out. Gateway conversations are separate from
existing Desktop/CLI sessions. This lock is not an OS sandbox.

## Restart, delivery failures and diagnostics

```bash
pnpm forge gateway status
```

This command displays the last persisted observation, not proof that a process is
currently alive. Ctrl+C or SIGTERM requests shutdown; the CLI permits up to ten
seconds before forced exit. On restart, unfinished tasks become interrupted and are
never automatically rerun. A tool may already have acted before a crash: inspect
existing effects before sending a fresh task. Completed conversation history is
reused, but pending approvals and processes are not resumed.

Temporary transport failures back off; failed replies retry at most five times after
the initial attempt. A saturated outbox or exhausted delivery pauses new tasks.
After repairing connectivity/credentials, stop the gateway and explicitly requeue
pending delivery:

```bash
pnpm forge gateway retry-delivery
pnpm forge gateway run
```

This retries replies only, never tasks. Ambiguous earlier sends can yield duplicate
replies with the same task ID. Old approvals are discarded. Invalid credentials stop
the connection; rotate the token in the environment before restarting. One bot may
have only one polling process on this host, even across different Forge homes.
A poller on another host can still cause Telegram conflicts; operate one host per bot.

Workspace/poller leases live in the OS temporary directory under a per-user
`forge-execution-*` directory. Dead process leases can be recovered; malformed leases
or an interrupted recovery guard fail closed. Diagnose owner processes before manual
local cleanup, never remove a live process's lease to bypass busy detection.

## Validation boundary

Deterministic tests use fake providers/transports, including a second adapter without
buttons. They do not prove Telegram network reachability or real-provider behavior.
The [specification](CHAT_CHANNELS_SPEC.md) retains live acceptance and release gates.
No new package version, npm publication, or Desktop release is implied by this guide.
