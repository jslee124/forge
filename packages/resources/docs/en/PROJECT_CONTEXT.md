# Project Context and Local Customization

简体中文 · Documentation index

## Goal

Forge understands repository-specific instructions and reusable Agent
resources without turning repository contents into an implicit permission grant.
It uses three deliberately separate conventions:

| Location | Purpose | Executable by itself |
| --- | --- | --- |
| `AGENTS.md` | Portable, human-readable project instructions | No |
| `.agents/` | Agent-agnostic reusable resources such as skills | No |
| `~/.forge/` | User-wide Forge settings, instructions, state, and plugins | Plugins are code |
| `<workspace-root>/.forge/` | Forge-specific project settings and plugins | Plugins are code |

Repository instructions may shape how the model approaches a task. They cannot
weaken the policy kernel, approve an action, select `full-access`, or bypass a
tool's normal approval and trace pipeline.

The implemented system includes schema-versioned user/project configuration,
instruction discovery and provenance, persistent sessions and traces,
model-invocable portable Skills, trusted plugins, and strictness-merged
context budgets.

## `AGENTS.md`

Forge follows the established uppercase filename `AGENTS.md`. On
case-sensitive filesystems, `agents.md` is a different file and is not an alias.
It also supports `AGENTS.override.md` for a more specific replacement at a
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

Forge parses bounded YAML frontmatter (`name`, task-oriented `description`, and
optional `disable-model-invocation`) and initially sends only escaped catalog
metadata to the model. Matching Skills are loaded on demand by opaque ID;
`$skill-name` remains a deterministic override. Project Skills are
model-invocable by default and require no plugin trust because they are never
imported or executed. `disable-model-invocation: true` makes one Skill available
only through an explicit user mention.

The same convention is available for built-in Skills shipped with Forge and
user Skills under `$FORGE_HOME/skills/`. Collisions resolve as
`project > user > builtin`, with shadowed sources recorded as diagnostics. New
portable subdirectories should only be added when there is a clear cross-agent
convention instead of placing Forge-specific data here.

## User-level `~/.forge/`

Forge uses `~/.forge/` as its default user home. `~` is resolved through the
operating system rather than relative to the current working directory. A
`FORGE_HOME` environment variable may override the location for portable
installations, testing, or managed environments.

The user layout is:

```text
~/.forge/
|-- config.json
|-- AGENTS.md
|-- skills/
|-- plugin-trust.json
|-- plugins/
|-- state/
|-- sessions/
`-- runs/
```

- `config.json` contains user-wide defaults such as provider, model, limits,
  context behavior, trace behavior, and the default permission profile.
- `AGENTS.md` contains optional user-wide instructions loaded before project
  instructions.
- `skills/` contains user-wide non-executable Skills discovered as bounded
  metadata and loaded lazily.
- `plugins/` contains explicitly installed or enabled user plugins.
- `state/` contains non-secret Forge state such as project-trust decisions.
- `sessions/` contains versioned completed conversation snapshots.
- `runs/` contains local traces when trace persistence is enabled.

Forge may create missing runtime subdirectories, but it must not overwrite an
existing configuration file. API keys and OAuth tokens do not belong in
`config.json`; Forge uses environment variables or the credential store defined
in the authentication model.

### Configuration schema

The Zod schema in `@forge/config` is the executable source of truth. See the
Configuration reference for every field, default, accepted
value, environment override, provider-route example, and merge rule.

The security-relevant summary is:

| Scope | May configure | Must not configure |
| --- | --- | --- |
| User `$FORGE_HOME/config.json` | Model, engine, provider routes, permission profile, limits, traces, plugins, context | API keys or OAuth credentials |
| Project `.forge/config.json` | Stricter `limits` and `context` values | Model/provider, permissions, traces, plugin enablement, routes, secrets |
| Environment | `FORGE_PROVIDER`, `FORGE_MODEL`, `FORGE_REASONING_EFFORT`, `FORGE_THINKING`, and credential variables | Permission widening |
| Explicit CLI | Supported command-scoped model, permission, limit, and context overrides | Repository trust or secret persistence through arguments |

Unknown fields are errors rather than silently ignored. `FORGE_HOME` changes
discovery location before configuration is loaded. There is intentionally no
environment variable that widens the permission profile.

User configuration is loaded before repository configuration. Forge should
provide `forge config show` to display the effective value and source of every
setting, and `forge config validate` to report invalid keys and values without
starting an Agent run.

## Project-level `.forge/`

The selected workspace root's `.forge/` is reserved for Forge-specific project
customization. The current 0.3.4 layout is:

```text
.forge/
|-- config.json
`-- plugins/
    `-- <plugin-name>/
        |-- plugin.json
        `-- index.mjs
```

The phrase "project-local" means the selected workspace root's canonical
`.forge/` directory. Forge will not search arbitrary parent directories or
nested directories for additional `.forge/plugins/` trees. This keeps plugin
discovery stable when Forge starts from a repository subdirectory.

Repository configuration may choose model-independent project behavior,
formatting, and stricter execution limits, but it cannot
relax the user's permission profile or core safety policy. Security-sensitive
keys such as the default permission profile, plugin enablement, and project
trust are user-only.
Unknown keys and unsupported schema versions must produce actionable
diagnostics.

Project plugins are trusted executable code. Forge must discover and summarize
them before loading, then require an explicit trust decision for the canonical
workspace path. Trust state is stored outside the repository so repository code
cannot mark itself trusted. In non-interactive mode, untrusted project plugins
are skipped. An explicit `forge plugins trust --yes` records trust outside the
project before later runs.

Forge will not automatically install plugin dependencies or run package-manager
lifecycle scripts during discovery.

## Precedence

For ordinary settings, later sources override earlier sources:

```text
built-in defaults < ~/.forge/config.json < project .forge/config.json
                  < environment variables < explicit CLI flags
```

Every configuration value keeps its source metadata so `forge config show` and
run traces can explain the effective result. Configuration discovery and merge
happen once at startup; Forge does not silently change settings during a run.
The schema classifies keys by scope: user-only security settings reject project
values, while safety limits use the stricter value instead of ordinary
last-writer-wins merging.

Security and instruction precedence are intentionally different:

```text
Security decisions: deny > confirm > allow (strictest contribution wins)
Instructions: user request > loaded skill > nearest project AGENTS.md
              > project-root AGENTS.md > ~/.forge/AGENTS.md
```

Skill name collisions use a separate resource rule:

```text
explicit $skill-name selection > project > user > builtin
```

Core policy defines a mandatory safety floor. Explicit CLI choices and user
configuration may select a supported permission profile, while project content
and plugins may only make an action stricter. They can never make a mandatory
decision less strict. The instruction ordering applies only when instructions
do not conflict with the security boundary or higher-level runtime constraints.
User-level `~/.forge/AGENTS.md` is loaded before the project hierarchy.
Forge-specific plugins may contribute prompt instructions only through typed
hooks, and their source must remain visible in the trace.

## Deferred decisions

- Configuration migrations beyond `schemaVersion: 1`
- Additional environment-variable mappings beyond the v0.1 model settings
- Additional Skill manifest and compatibility rules beyond the current
  `SKILL.md` convention
- Whether restricted plugins run in a child process or an OS sandbox
