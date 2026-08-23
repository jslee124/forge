# MCP stdio plugin example

This example proves that Forge's current plugin API can bridge model calls to a
stdio MCP server. It registers two `process`-risk tools, so every server launch
still goes through Forge policy and approval:

- `mcp_list_tools`
- `mcp_call_tool`

Copy this directory to `.forge/plugins/mcp-stdio`, trust the workspace, and set
the server command as a JSON string array (no shell parsing):

```sh
export FORGE_MCP_COMMAND='["node","/absolute/path/to/server.mjs"]'
```

This dependency-free teaching example implements newline-delimited stdio MCP
at protocol revision `2025-11-25`. It starts a fresh server for each Forge tool
call, performs the session-based initialize handshake, applies Forge's command
timeout/output bounds, and closes the subprocess afterward. It does not support
Streamable HTTP, roots, resources, prompts, sampling, notifications, MCP tasks,
server reuse, or the handshake-free `2026-07-28` revision. Production MCP host
support belongs in Forge core or a lifecycle-aware plugin API, ideally using an
official MCP SDK.
