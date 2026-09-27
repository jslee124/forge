# Desktop 0.3.4 Preview 4 release candidate

Status on 2026-09-27: **prepared locally; not published**. This record concerns the candidate based on `dev` commit `6371281` plus the Preview 4 preparation changes. It is not public release or cross-platform acceptance evidence. [中文](README.zh-CN.md).

## Local verification

- `CI=true pnpm check` passed after the preparation and installed-acceptance fix. The existing Biome diagnostics were 4 warnings and 18 informational messages.
- `CI=true pnpm check:docs` passed: 212 Markdown files and 830 local references.
- `CI=true pnpm package:verify` passed for the separate CLI npm package; `CI=true pnpm eval:deterministic` passed 13 files and 71 tests.
- `CI=true FORGE_DESKTOP_BUILD_TAG=desktop-0.3.4-preview.4 pnpm desktop:package` produced unsigned arm64/x64 DMGs and ZIPs locally. `release-contract.mjs` recorded the full preview identity and four asset hashes; `shasum -a 256 -c SHA256SUMS` verified all four files.
- The local arm64 packaged-app smoke passed. An initial installed-app probe found that the redesigned Workbench panel starts closed; the probe now selects the resumed task through the UI before opening its file. After rebuilding, the arm64 DMG passed the temporary installation, LaunchServices startup, Agent shutdown, PDF preview, and isolated-home checks. The candidate's [installed-app result](local-macos-arm64/installed.json) and [PDF screenshot](local-macos-arm64/installed-pdf.png) are preserved separately from older D13 evidence.
- The candidate branch [CI run](https://github.com/jslee124/forge/actions/runs/36297371802) passed Ubuntu verification and Windows x64 packaging, packaged-app smoke, and NSIS install/start/uninstall. It used a CI build identity and skipped the macOS preview and publication jobs.

## Still required before publication

- Re-run the Windows x64 checks from the final Preview 4 tag so the installer embeds the release identity, and compare its assets with the candidate CI result.
- Run macOS packaging and smoke from the final tag in CI; assemble Windows and macOS assets, verify their SHA-256 values and remote GitHub asset sizes/digests, then publish the prerelease.
- Update the current English/Chinese Desktop and installation guides to identify Preview 4 after it is public. Until then, they correctly identify Preview 3 as the current published preview.

The candidate remains unsigned and the macOS DMGs are not notarized. Local arm64 acceptance does not establish Intel hardware, macOS 13, downloaded-file quarantine/Gatekeeper behavior, native traffic-light hit targets, system full screen, or live-provider calls. Windows ARM64 and signed Windows installer acceptance are outside this preview.
