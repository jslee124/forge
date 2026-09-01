# @jslee124/forge

Forge is a safe, observable, and evaluable coding-agent CLI. It keeps model
requests, tool proposals, approval decisions, execution results, and traces in
one inspectable runtime.

## Install

Forge requires Node.js 24 or newer.

```bash
npm install --global @jslee124/forge
forge --version
forge
```

For Chinese documentation, see the
[Simplified Chinese README](https://github.com/jslee124/forge/blob/main/README.zh-CN.md).

Forge supports API-key access for DeepSeek and OpenAI-compatible providers, as
well as ChatGPT subscription access through the official Codex App Server. Run
`forge auth status` or use `/login` in the interactive terminal to inspect the
available authentication routes.

## Update

```bash
forge update check
forge update
forge update 0.3.4
```

Forge never installs an update merely because the CLI started. `forge update`
is an explicit request and installs the exact version resolved from the npm
registry. Set `FORGE_DISABLE_UPDATE_CHECK=1` to disable the advisory background
check performed during interactive startup.

Documentation, source, security boundaries, and evaluation evidence are
available in the [Forge repository](https://github.com/jslee124/forge).
