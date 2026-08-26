# Code-review subagent plugin example

This example registers a declarative `code-reviewer` role. Forge exposes it to
the parent model as the `delegate_code_review` tool, but the plugin never gets a
model adapter, API credential, policy object, trace writer, or session handle.
The host owns those resources.

Copy this directory to `.forge/plugins/code-review-subagent`, review it, and
trust the workspace. A delegated call requires explicit approval because the
generated tool has `model` risk and incurs another model run.

The child run:

- uses a fresh adapter and isolated conversation;
- inherits project instructions, workspace, cancellation, context settings,
  approval channel, and the parent policy after plugin restrictions;
- receives only `list_files`, `read_file`, and `search`;
- cannot see subagent tools, so it cannot recursively delegate;
- is capped at four model steps and eight tool calls, inside the shared parent
  subagent budget;
- writes a separate trace linked to the parent run when tracing is enabled;
- returns bounded final text and run metadata through the parent tool result.

This example is deliberately read-only. A different trusted plugin may grant a
subagent write or process tools, but every such child tool call still follows
the inherited core policy and approval flow.
