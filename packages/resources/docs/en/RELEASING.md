# npm Release Guide

简体中文 · Documentation index

Forge keeps its implementation packages private and publishes one user-facing
package: `@jslee124/forge`. The generated package contains the CLI, bundled
`@forge/*` workspace code, and reviewed version-matched built-in Skill assets.
Third-party libraries remain ordinary npm runtime dependencies. The plugin SDK
is not a separately published package.

## Distribution contract

- Install: `npm install --global @jslee124/forge`
- Command: `forge`
- Stable npm tag: `latest`
- Prerelease npm tag: `next`
- Runtime baseline: Node.js 24 or newer
- Generated package directory: `dist/npm/forge`

The source package at `apps/cli` remains private. `pnpm build:package` creates
the public manifest and bundle in the ignored `dist/npm/forge` directory, so
development-only files cannot enter the registry by accident.

## Prepare a release

Start from a clean checkout and choose a semantic version:

```bash
pnpm version:set 0.3.0
pnpm install --frozen-lockfile
pnpm check
pnpm check:docs
pnpm test
pnpm eval:deterministic
pnpm package:verify
pnpm release:verify-tag v0.3.0
```

`package:verify` builds the public artifact, inspects the tarball, installs it
into a fresh temporary prefix with lifecycle scripts disabled, verifies the
exact built-in Skill/reference/template allowlist and API version, and checks
`forge --version`, `forge --help`, and `forge config validate`.

Review `npm pack --dry-run` output and release notes before tagging. Never
include API keys, auth files, local traces, `.env` files, or evaluation
artifacts that were not explicitly reviewed for publication.

## First npm publication

The npm account or organization must control the `@jslee124` scope and have 2FA
enabled. npm requires a package to exist before a trusted publisher can be
attached. Bootstrap the package with a reviewed prerelease such as
`0.3.0-bootstrap.0` under a non-stable dist-tag, then configure the repository's
`publish.yml` as the package's GitHub Actions trusted publisher. Do not assign
the bootstrap build to `latest`.

After trusted publishing is configured, stable releases should come only from
the tag workflow. It uses OIDC instead of a long-lived npm token and publishes
the generated package after all release gates pass.

## Publish a stable release

Commit the version, release notes, and generated-input changes, then create an
annotated immutable tag:

```bash
git tag -a v0.3.0 -m "Forge v0.3.0"
git push origin v0.3.0
```

The `Publish npm package` workflow verifies that the Git tag, root version,
private workspace versions, runtime version, and generated npm package all
match before it runs `npm publish --access public`.

Use `npm publish --tag next` only for deliberate prereleases. Do not move a
published Git tag or reuse an npm version. Fix a bad release with a new patch
version and leave the prior artifact available for rollback.

## User updates

Installed users can check or update explicitly:

```bash
forge update check
forge update
forge update 0.3.1
```

Interactive startup refreshes an advisory npm check in the background at most
once per 24 hours and displays cached results on a later launch. It never
installs an update automatically. Set
`FORGE_DISABLE_UPDATE_CHECK=1` to disable startup checks. The explicit update
command resolves npm metadata to an exact semantic version before invoking
`npm install --global --ignore-scripts`.
