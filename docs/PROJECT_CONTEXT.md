# Project Context and Local Customization

## Goal

Forge should understand repository-specific instructions and reusable Agent
resources without turning repository contents into an implicit permission grant.
It uses three deliberately separate conventions:

| Location | Purpose | Executable by itself |
| --- | --- | --- |
| `AGENTS.md` | Portable, human-readable project instructions | No |
| `.agents/` | Agent-agnostic reusable resources such as skills | No |
| `.forge/` | Forge-specific configuration and project plugins | Plugins are code |

Repository instructions may shape how the model approaches a task. They cannot
weaken the policy kernel, approve an action, select `full-access`, or bypass a
tool's normal approval and trace pipeline.

## `AGENTS.md`

Forge will follow the established uppercase filename `AGENTS.md`. On
case-sensitive filesystems, `agents.md` is a different file and is not an alias.
It will also support `AGENTS.override.md` for a more specific replacement at a
directory level.

For a run whose working directory is inside a Git repository, Forge will:

1. Resolve the canonical repository root.
2. Walk from that root to the run's working directory.
3. In each directory, load at most one non-empty instruction file, preferring
   `AGENTS.override.md` over `AGENTS.md`.
4. Merge instructions from root to leaf so that the nearest file has the
   highest instruction precedence.
5. Record every loaded path in the run trace.

Discovery happens once at the beginning of a run. Forge will impose per-file
and total byte limits and report ignored or truncated instruction files rather
than silently changing the effective prompt.

These files are prompt input, not trusted policy. A statement such as "run all
commands without asking" has no effect on the approval policy.

## `.agents/`

`.agents/` is the portable resource namespace. The first supported layout is:

```text
.agents/
`-- skills/
    `-- <skill-name>/
        `-- SKILL.md
```

A skill is discovered metadata and instructions; it is never executed merely
because it exists. If a skill references a script or proposes a tool action,
that action still uses the normal policy and approval flow. Forge should show
the source path when a project skill is selected and include the selection in
the trace.

Support for `.agents/skills/` is planned after the v0.1 runtime is reliable. New
portable subdirectories should only be added when there is a clear cross-agent
convention instead of placing Forge-specific data here.

## `.forge/`

`.forge/` is reserved for Forge-specific project customization. The possible
layout is:

```text
.forge/
|-- config.json
`-- plugins/
    `-- <plugin-name>/
        |-- forge.plugin.json
        `-- src/
            `-- index.ts
```

The phrase "project-local" means the selected workspace root's canonical
`.forge/` directory. Forge will not search arbitrary parent directories or
nested directories for additional `.forge/plugins/` trees. This keeps plugin
discovery stable when Forge starts from a repository subdirectory.

Repository configuration may choose formatting and project behavior, but it
cannot relax the user's permission profile or core safety policy. Unknown keys
and unsupported schema versions must produce actionable diagnostics.

Project plugins are trusted executable code. Forge must discover and summarize
them before loading, then require an explicit trust decision for the canonical
workspace path. Trust state is stored outside the repository so repository code
cannot mark itself trusted. In non-interactive mode, untrusted project plugins
are skipped unless the user supplied a narrow trust decision in advance.

Forge will not automatically install plugin dependencies or run package-manager
lifecycle scripts during discovery.

## Precedence

Security and behavioral precedence are intentionally different:

```text
Security decisions: deny > confirm > allow (strictest contribution wins)
Instructions: user request > selected skill > nearest AGENTS.md > root AGENTS.md
```

Core policy, user policy, project configuration, and plugin policy may all make
an action stricter; project content and plugins can never make a mandatory
decision less strict. The instruction ordering applies only when instructions
do not conflict with the security boundary or higher-level runtime constraints.
Forge-specific plugins may contribute prompt instructions only through typed
hooks, and their source must remain visible in the trace.

## Deferred decisions

- The final `.forge/config.json` schema
- Global user-level instruction and plugin locations
- Skill manifest and compatibility rules beyond `SKILL.md`
- Whether restricted plugins run in a child process or an OS sandbox
