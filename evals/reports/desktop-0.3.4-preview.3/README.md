# Desktop 0.3.4 Preview 3 release evidence

Published on 2026-09-23 (Asia/Shanghai) as a public GitHub prerelease:
[Preview 3](https://github.com/jslee124/forge/releases/tag/desktop-0.3.4-preview.3).
See [machine-readable evidence](release.json) and [中文](README.zh-CN.md).

- The tag points to `612da758562e37d5907ed2913ae86fbf9392c86e` on `dev`. [Tag CI](https://github.com/jslee124/forge/actions/runs/35825140016) passed Ubuntu checks and Windows packaging, installed-app smoke, and uninstall checks.
- The [publication CI](https://github.com/jslee124/forge/actions/runs/35830601966) passed all four jobs. It rebuilt the Windows x64 NSIS installer and macOS arm64/x64 DMGs from that tag, checked their SHA-256 values against each platform manifest, uploaded five release assets, verified GitHub's asset sizes and digests, and published the prerelease.
- Local `CI=true pnpm check` and full tests passed (492 passed, 6 skipped). A local macOS arm64 unpacked-app smoke also passed. This is separate from Windows runner acceptance.
- All five public asset download URLs returned HTTP 200 to HEAD requests. The downloaded public `SHA256SUMS` and `desktop-build.json` match their GitHub SHA-256 digests; the three installer entries in both files match GitHub's installer digests. Full installers were not downloaded again after publication.
- The release is a prerelease, not a draft. Stable latest remains `v0.3.4`, and the desktop tag did not trigger the npm release workflow.

The installers are unsigned; macOS DMGs are not notarized. Windows CI did not test real-provider authentication or calls, Windows ARM64, SmartScreen acceptance, or every supported machine. The macOS CI smoke and local arm64 smoke do not establish installed-app acceptance on all Mac hardware. Preview 2 retains macOS ZIP downloads. See the [Windows installation guide](../../../apps/desktop/INSTALL-WINDOWS.md) and [macOS installation guide](../../../apps/desktop/INSTALL.md).
