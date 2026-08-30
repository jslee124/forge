# Forge v0.3.0 release notes

[简体中文](../../zh-CN/history/v0.3.0/RELEASE_NOTES.md) · [Documentation index](../../README.md)

> Document role: historical. This page records the v0.3.0 release and is not
> current-product documentation.

Forge v0.3.0 is the first stable release distributed through npm. It preserves
the private monorepo architecture while exposing one installable, bundled CLI.

## Install and update

Forge requires Node.js 24 or newer.

```bash
npm install --global @jslee124/forge
forge --version
```

The npm `latest` dist-tag points to `0.3.0`. Installed users can check for or
request an update explicitly:

```bash
forge update check
forge update
forge update 0.3.0
```

Interactive startup performs only a cached advisory check, at most once per 24
hours. It never installs an update automatically. Set
`FORGE_DISABLE_UPDATE_CHECK=1` to disable that check. Explicit updates resolve
an exact semantic version and invoke npm with lifecycle scripts disabled; they
do not modify `$FORGE_HOME` credentials, configuration, sessions, traces, or
plugins.

## Distribution and release safety

- `@jslee124/forge` is the only public package.
- Private `@forge/*` workspace code is bundled into the generated CLI artifact.
- The plugin SDK and internal workspace packages are not separately published.
- The public tarball is generated in `dist/npm/forge` and clean-install tested
  before publication.
- Stable releases are published from immutable `v*` Git tags by GitHub Actions
  using npm Trusted Publishing and OIDC, without a long-lived npm token.
- The one-time `0.3.0-bootstrap.0` prerelease remains under the `bootstrap`
  dist-tag; it is not the default installation target.

## Product and developer changes

- Added explicit npm update checking and installation commands with nonblocking
  startup advisories.
- Added host-managed, bounded plugin subagents that continue to use host-owned
  credentials, policy, budgets, and traces.
- Added MCP stdio, to-do, and read-only code-review subagent examples.
- Expanded and reorganized English and Simplified Chinese documentation around
  installation, configuration, troubleshooting, security, and release tasks.

## Release verification

The tagged source passed formatting and type checks, documentation-link checks,
the complete Vitest suite, deterministic evaluation, generated-package
inspection, clean-prefix installation, CLI version/help/configuration smoke
tests, and tag-to-package version verification before npm publication.

Model behavior remains nondeterministic. These gates verify the release
pipeline and tested runtime behavior; they do not guarantee success on every
live provider task.
