# Chat Channels (Experimental)

[简体中文](zh-CN/CHAT_CHANNELS.md) · [Documentation index](README.md)

The development checkout provides a foreground Telegram gateway for one owner,
one private conversation, and one workspace. It reuses the Forge native engine,
model configuration, tools, and persisted sessions. This is an unreleased source
feature targeting 0.4.0. Core live Telegram tests passed on macOS; full acceptance
and publication remain pending.
Codex engine, groups, voice, attachments, background service installation, and
Desktop gateway settings are not supported.

## 1. Prepare source, model and workspace

These commands target macOS zsh or Linux Bash, not PowerShell. You need Node.js 24+,
pnpm 11.18.0, a signed-in Telegram account and native model credentials. Use a
source checkout containing the gateway command; this feature is unreleased, so do
not assume the stable npm package includes it. From the Forge checkout root:

```bash
pnpm install --frozen-lockfile
pnpm build
export FORGE_CHECKOUT="$PWD"
export FORGE_HOME="$HOME/.forge-telegram"
export FORGE_TEST_WORKSPACE="$HOME/forge-telegram-workspace"
mkdir -p "$FORGE_HOME" "$FORGE_TEST_WORKSPACE"
cd "$FORGE_TEST_WORKSPACE"
node "$FORGE_CHECKOUT/apps/cli/dist/index.js"
```

This creates a separate durable profile; it does not inherit credentials or model
settings from `~/.forge`. Use `/login` to configure credentials and `/model` to select
the **Forge native engine** and an available model. Send “Reply TEST_OK only, without
using tools”, then `/exit` after receiving the reply. See [Getting started](GETTING_STARTED.md)
for authentication options. Real model requests may incur charges. Keep the test
workspace outside the source repository; a directory inside another Git repository
can resolve to that project's root.

Use the same terminal for subsequent steps. You may reuse an existing profile, but
all steps must use the same `FORGE_HOME`. Start with this test workspace before
configuring a real project.

## 2. Create a Telegram bot

1. Open official [@BotFather](https://t.me/BotFather) in Telegram and check its username.
2. Click Start and send `/newbot`.
3. Enter a display name, such as `Forge Assistant`.
4. Follow the prompt to choose an available username ending in `bot`.
5. Keep the returned token and open the bot's private-chat link.

The token authenticates the bot; it is neither your personal login code nor a model
API key. Signing into Telegram Web alone does not connect Forge. See the
[official Telegram tutorial](https://core.telegram.org/bots/tutorial).

## 3. Set the token privately

For macOS's default zsh:

```zsh
read -rs 'FORGE_TELEGRAM_BOT_TOKEN?Paste Bot Token, then press Enter: '
echo
export FORGE_TELEGRAM_BOT_TOKEN
```

For Bash:

```bash
read -rsp 'Paste Bot Token, then press Enter: ' FORGE_TELEGRAM_BOT_TOKEN
echo
export FORGE_TELEGRAM_BOT_TOKEN
```

Input is hidden and the token is not embedded in command history. Do not put it in
browser URLs, repository files, screenshots or reports. The variable only applies
to this terminal and its children; set it again in a new terminal. Do not inspect
secrets with `echo` or a full environment dump.

## 4. Find your numeric user ID

Do not start the gateway or another poller yet. In your new **bot's private chat**,
click Start and send `/forge_setup_id`. No reply is expected while the gateway is
stopped; this message is only used to identify your account.

Run this script in the same terminal. It queries Telegram's official API and prints
only a matching numeric ID, not the token or full message records. Only use your
own ID as the owner.

```bash
node --input-type=module <<'NODE'
const token = process.env.FORGE_TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("Set FORGE_TELEGRAM_BOT_TOKEN first");
try {
  const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ timeout: 0, allowed_updates: ["message"] }),
    signal: AbortSignal.timeout(15000),
    redirect: "error",
  });
  const data = await response.json();
  if (!data.ok) {
    console.error("Telegram API error:", data.error_code ?? response.status);
    process.exitCode = 1;
  } else {
    const ids = [...new Set(data.result
      .map(update => update.message)
      .filter(message => message?.chat?.type === "private"
        && !message.from?.is_bot && message.text === "/forge_setup_id"
        && message.chat.id === message.from?.id)
      .map(message => String(message.from.id)))];
    console.log(ids.length === 1 ? `Owner ID: ${ids[0]}`
      : "No unique owner found. Send /forge_setup_id from your own account and retry.");
  }
} catch {
  console.error("Request failed. Check network, proxy and token; do not print the token.");
  process.exitCode = 1;
}
NODE
```

Record the number after `Owner ID:`. It is not your `@username` or the bot ID before
the token's colon. If none is found, send the command again to the correct bot and
rerun the script. If multiple candidates appear, verify identity before proceeding;
never automatically trust the first sender. This method is intended for a new
 dedicated bot; resolve any existing webhook or poller conflict first. See
[getUpdates](https://core.telegram.org/bots/api#getupdates).

## 5. Configure and start the gateway

Replace `123456789` with your verified numeric user ID:

```bash
node "$FORGE_CHECKOUT/apps/cli/dist/index.js" gateway setup telegram \
  --owner 123456789 \
  --workspace "$FORGE_TEST_WORKSPACE" \
  --alias sandbox \
  --permission-profile safe \
  --accept-remote-disclosure
node "$FORGE_CHECKOUT/apps/cli/dist/index.js" gateway run
```

Setup prints a confirmation. Run is a foreground process and normally does not
return to the shell prompt. The startup line alone does not prove connectivity;
verify the connection from Telegram in the next section.

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

## 6. Verify the connection and approvals

Send `/start` or `/help` in the bot's private chat. Expect a command list and the
`sandbox` alias. Send `/status` and expect a status reply; these commands do not call
a model. Run each test below after the previous task finishes:

| Action | Expected result |
| --- | --- |
| Ask for TEST_OK without tools | Acceptance notice followed by the model response |
| Ask it to remember TG-TEST-123, then recall it | The same conversation retains the marker |
| Ask to create hello.txt containing hello telegram | Action details and Allow once / Deny buttons; writing waits for approval |
| Ask to create denied.txt and stop if denied | Deny prevents file creation |
| Ask to create cancelled.txt, then send `/cancel` while awaiting approval | Cancellation prevents the write and invalidates the old approval |

Use the test workspace for writes. Check local files directly; model narration alone
is not execution evidence. After a task completes, press Ctrl+C locally and run
`gateway run` with the same environment. Ask for the marker again to verify session
recovery. The live smoke included an inaccurate model claim about an earlier write;
the file and execution records remained the verification source.

## Private-chat commands and boundaries

| Input | Result |
| --- | --- |
| Text | Start a task if the workspace and gateway are idle |
| `/help` or `/start` | Show supported commands |
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
node "$FORGE_CHECKOUT/apps/cli/dist/index.js" gateway status
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
node "$FORGE_CHECKOUT/apps/cli/dist/index.js" gateway retry-delivery
node "$FORGE_CHECKOUT/apps/cli/dist/index.js" gateway run
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

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Missing token error | Repeat hidden token entry in the terminal that starts the gateway |
| Already configured | Use run with the original FORGE_HOME; stop and archive old state before changing bindings |
| Native engine required | Select the native engine with `/model` under the same home and workspace |
| No bot reply | Check the process, host sleep, correct bot, numeric owner ID and Telegram connectivity |
| Help works but tasks fail | Try a simple local interactive task using the same profile; check model credentials and quota |
| Webhook or polling conflict | Use a dedicated bot and stop other pollers; only remove an old webhook after confirming the previous integration is no longer needed |
| workspace-busy | Wait for or stop the competing Forge task; do not delete an active lease |
| Local status says connected but no reply | Local status is historical and does not prove that the process is alive |

In a new terminal, set `FORGE_CHECKOUT`, `FORGE_HOME` and the token again, then run
`gateway run`; setup is not repeated. Manage a lost or exposed credential through
BotFather and update the environment before restarting. These shell instructions
do not establish live Windows acceptance.

## Validation boundary

On 2026-09-29, a macOS live smoke using Telegram and DeepSeek verified conversation,
approval, denial, cancellation, stale approvals and memory after restart. Full
acceptance, including a second unauthorized account, network faults and other
platforms, remains incomplete.

Deterministic tests use fake providers/transports, including a second adapter without
buttons. They do not prove Telegram network reachability or real-provider behavior.
The [specification](CHAT_CHANNELS_SPEC.md) retains live acceptance and release gates.
No new package version, npm publication, or Desktop release is implied by this guide.
