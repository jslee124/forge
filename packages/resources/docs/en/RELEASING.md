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

Start from a clean checkout and choose a semantic version. Replace `0.3.4`
below with the release being prepared:

```bash
pnpm version:set 0.3.4
pnpm install --frozen-lockfile
pnpm check
pnpm check:docs
pnpm test
pnpm eval:deterministic
pnpm package:verify
pnpm release:verify-tag v0.3.4
```

`package:verify` builds the public artifact, inspects the tarball, installs it
into a fresh temporary prefix with lifecycle scripts disabled, verifies the
exact built-in Skill/reference/template allowlist and API version, and checks
`forge --version`, `forge --help`, and `forge config validate`.

Review `npm pack --dry-run` output and release notes before tagging. Never
include API keys, auth files, local traces, `.env` files, or evaluation
artifacts that were not explicitly reviewed for publication.

Every public version must also include an English GitHub release body at
`.github/releases/v<version>.md`. Keep it user-facing: summarize highlights,
show the npm install command, link the reviewed verification evidence, and
state material compatibility or validation limits. `pnpm check` verifies that
the current-version file contains those sections and does not retain candidate
status wording.

## One-time npm setup (completed)

The first publication was completed for v0.3.0. The `@jslee124` scope is
controlled by the maintainer, and `.github/workflows/publish.yml` is registered
as the package's GitHub Actions trusted publisher. The one-time bootstrap used
`0.3.0-bootstrap.0` under the `bootstrap` dist-tag. Stable releases now own the
`latest` dist-tag; verify the current registry state with
`npm view @jslee124/forge version dist-tags --json` instead of copying a
version claim from this guide. Do not repeat the bootstrap procedure for later
releases.

Stable releases must come only from the tag workflow. It uses OIDC instead of a
long-lived npm token and publishes the generated package after all release
gates pass. If the trusted-publisher configuration is ever replaced, review the
npm package settings and workflow identity together before creating a tag.

## Publish a stable release

Commit the version, release notes, and generated-input changes, then create an
annotated immutable tag:

```bash
git tag -a v0.3.4 -m "Forge v0.3.4"
git push origin v0.3.4
```

The `Publish npm package` workflow verifies that the Git tag, root version,
private workspace versions, runtime version, and generated npm package all
match before it publishes with an explicit dist-tag. Stable semantic versions
route to `latest`; versions with a prerelease component route to `next`. After
the npm publication succeeds, the same workflow creates the GitHub Release
from `.github/releases/v<version>.md`. Stable versions are marked `Latest`;
prerelease versions are marked `Pre-release`. GitHub automatically adds source
ZIP and tarball downloads for the immutable tag; Forge does not publish a
separate standalone binary archive.

Do not move a published Git tag or reuse an npm version. Fix a bad release with
a new patch version and leave the prior artifact available for rollback.

## User updates

Installed users can check or update explicitly:

```bash
forge update check
forge update
forge update 0.3.4
```

Interactive startup publishes cached, refreshing, available, current, failed,
or disabled state inside Ink and refreshes npm metadata at most once per 24
hours. A late result updates the banner without entering conversation history.
It never installs automatically; `/update-dismiss` dismisses that version. Set
`FORGE_DISABLE_UPDATE_CHECK=1` to disable startup checks. The explicit update
command remains repeatable and resolves an exact semantic version. It invokes
npm or pnpm with an argument array and `--ignore-scripts` only when installation
provenance is recognized; otherwise it reports the version and release notes
without guessing. A successful install still requires restarting Forge.
