# Forge Desktop local installation

[简体中文](INSTALL.zh-CN.md) · [D13 development evidence](d13-qa.md)

Forge Desktop is a private workspace application, separate from the public Forge CLI package.
The current local build is 0.3.4, Electron 44.2.0 and electron-builder 26.15.3.
The configured minimum is macOS 13.0; this does not imply testing on every macOS release.
Choose arm64 for Apple Silicon or x64 for Intel. See the acceptance record for actual host coverage.

## Develop and build

From the repository root, with Node 24+ and the pinned pnpm version in package.json:

```sh
CI=true pnpm install --frozen-lockfile
CI=true pnpm check
pnpm desktop:dev
CI=true FORGE_DESKTOP_BUILD_TAG=desktop-0.3.4-preview.2 pnpm desktop:package
```

Packaging builds the renderer, preload, main and Agent, prepares the locked web plugin,
and creates DMG/ZIP files for both architectures under `apps/desktop/release/`.
The default package command disables certificate discovery and publication. It may download
architecture-specific Electron and DMG tooling. Do not use the host `electronDist` for a
cross-architecture build: it can produce a filename that disagrees with the executable.
Keep pnpm dependency-age protection enabled. No global CLI install is required to run the app.

## Install and start

Open the matching DMG and copy **Forge Desktop.app** to Applications; eject the image.
Alternatively extract the ZIP and move the app to Applications. Quit an existing copy before
replacing it. Keep the previous local artifact if a rollback may be needed.
These development artifacts have no Developer ID signature or notarization. macOS can block
them; inspect the source and checksum before using the system's explicit Open Anyway option
for a trusted local build. Do not disable Gatekeeper globally. [Preview 2](https://github.com/jslee124/forge/releases/tag/desktop-0.3.4-preview.2) is published as an unsigned, non-notarized prerelease.

Launch the app from Applications. Closing its last window quits the app and shuts down its
Agent; it is not a background worker. Cancellation/exit does not roll back existing file edits.
Reopen a saved task to continue. Uninstalling the application does not delete Forge sessions,
configuration, credentials or workspaces; manage those separately rather than deleting them
as part of a routine app update.

## Configuration, authentication and network

The Agent reads shared Forge configuration and credentials. Default storage is `~/.forge`;
`FORGE_HOME` overrides it. Finder/LaunchServices does not source your interactive shell profile.
The app inherits launch environment variables; it does not automatically import shell PATH,
proxy variables, or system proxy preferences. For an explicit custom launch, for example:

```sh
open -n --env "FORGE_HOME=$HOME/.forge" \
  --env "FORGE_CODEX_PATH=/absolute/path/to/codex" \
  "/Applications/Forge Desktop.app"
```

Replace the Codex path with your actual installed executable. Native Forge credentials and
Codex ChatGPT authentication are separate. Codex is not bundled; install/configure it separately.
The UI reports unavailable/signed-out states instead of silently switching engines.
`FORGE_CODEX_PATH` selects its executable even when GUI PATH omits Homebrew directories.
Existing Codex authentication is read by the Codex process; a Forge provider key does not log
in to Codex. The app's login control opens the supported browser authentication flow.

For native network requests, provide HTTP_PROXY/HTTPS_PROXY (or lowercase equivalents), with
NO_PROXY as needed, in the application launch environment. Lowercase takes precedence. Avoid
putting credentials in shared launch scripts. The installed acceptance checks a clean proxy-free
launch; it does not prove connectivity through your proxy or Codex's separate network stack.

Install the bundled web-tools from Settings, then explicitly enable it. Native network calls
still require approval. Brave needs BRAVE_SEARCH_API_KEY in the Agent environment; without a key,
Auto selects DuckDuckGo. Failures do not silently switch search services. Codex uses its own tools.

## Files, PDF and verification

Choose a workspace or let a new task create its own workspace. File import copies into that
workspace; conflicts require an explicit choice. Previews use workspace-relative paths.
PDF previews use the bundled PDF.js worker, CMaps, standard fonts and WASM; textless PDFs do
not gain OCR. The installation smoke covers a simple text PDF, not every font/encryption format.

After packaging, run from `apps/desktop`:

```sh
node scripts/acceptance-installed.mjs release/forge-desktop-0.3.4-arm64.dmg
node scripts/acceptance-installed.mjs release/forge-desktop-0.3.4-arm64.zip
```

Use x64 filenames for the other architecture. The harness mounts DMG read-only or extracts ZIP,
copies to a temporary Applications directory, starts via LaunchServices with a restricted PATH,
empty proxy values and an isolated FORGE_HOME, checks installed services/PDF/auth status, waits
for app exit and confirms its Agent PID has exited. It saves sanitized evidence under `qa/d13`
and removes temporary installed copies/data. It does not call a model or authenticate a user.

The updater checks official desktop GitHub Releases and supports verified downloads and manual replacement.
Developer ID signing, notarization and automatic replacement are not configured. CLI npm package
verification is independent of these desktop distribution steps.

## Version checks and manual updates

Builds with the update feature check official desktop releases in the background after startup and never download automatically. Settings → Version and updates shows the full version, stable/preview channel, manual check and startup preference. Preview also accepts newer stable builds; channel changes never downgrade the app.

Choose Download update beside Settings. After downloading and SHA-256 verification, choose Open installer. Cancellation preserves the notice; failures can be retried. Opening rechecks the managed file and explains the steps: save work, quit the old Forge, then drag into Applications to replace it. Opening a DMG does not quit or install automatically; draft and active-task exit guards remain.

Existing old builds require one manual upgrade to obtain this feature. `desktop-0.3.4-preview.2` is the [published preview identity](https://github.com/jslee124/forge/releases/tag/desktop-0.3.4-preview.2). Missing identity is explicit and is never guessed from `0.3.4`. Packaging requires an explicit identity and generates `desktop-build.json` and `SHA256SUMS`.

Update networking uses Chromium's system proxy support and no model-provider credentials. Rate limits, timeouts and proxy errors never mean up to date. SHA-256 is not Apple signing or notarization; the updater never removes quarantine or bypasses Gatekeeper. See [update QA](update-qa.md) for evidence.
