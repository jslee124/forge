# npm Release Guide

[简体中文](zh-CN/RELEASING.md) · [Documentation index](README.md)

Forge keeps its implementation packages private and publishes one user-facing
package: `@jslee124/forge`. The generated package contains the CLI plus bundled
`@forge/*` workspace code. Third-party libraries remain ordinary npm runtime
dependencies. The plugin SDK is not a separately published package.

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

Start from a clean checkout and choose a semantic version. Replace `0.3.1`
below with the release being prepared:

```bash
pnpm version:set 0.3.1
pnpm install --frozen-lockfile
pnpm check
pnpm check:docs
pnpm test
pnpm eval:deterministic
pnpm package:verify
pnpm release:verify-tag v0.3.1
```

`package:verify` builds the public artifact, inspects the tarball, installs it
into a fresh temporary prefix with lifecycle scripts disabled, and verifies
`forge --version`, `forge --help`, and `forge config validate`.

Review `npm pack --dry-run` output and release notes before tagging. Never
include API keys, auth files, local traces, `.env` files, or evaluation
artifacts that were not explicitly reviewed for publication.

## One-time npm setup (completed)

The first publication was completed for v0.3.0. The `@jslee124` scope is
controlled by the maintainer, and `.github/workflows/publish.yml` is registered
as the package's GitHub Actions trusted publisher. The one-time bootstrap used
`0.3.0-bootstrap.0` under the `bootstrap` dist-tag; `latest` now points to the
stable `0.3.0` release. Do not repeat the bootstrap procedure for later
releases.

Stable releases must come only from the tag workflow. It uses OIDC instead of a
long-lived npm token and publishes the generated package after all release
gates pass. If the trusted-publisher configuration is ever replaced, review the
npm package settings and workflow identity together before creating a tag.

## Publish a stable release

Commit the version, release notes, and generated-input changes, then create an
annotated immutable tag:

```bash
git tag -a v0.3.1 -m "Forge v0.3.1"
git push origin v0.3.1
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
