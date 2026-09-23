# Forge Desktop for Windows (preview)

[简体中文](INSTALL-WINDOWS.zh-CN.md) · [Desktop guide](../../docs/DESKTOP.md)

The Windows preview is for x64 PCs. Download `forge-desktop-0.3.4-x64.exe`
and `SHA256SUMS` from the same [Desktop Preview 3 release](https://github.com/jslee124/forge/releases/tag/desktop-0.3.4-preview.3).
In PowerShell, run `Get-FileHash .\forge-desktop-0.3.4-x64.exe -Algorithm SHA256`
and compare the hash with the installer line in `SHA256SUMS` before running it.

The NSIS installer is unsigned. Windows may display a security warning. Check
the GitHub release source and hash, then use the system's explicit option to
continue only if you trust this preview. Installation is per user and does not
require a global Forge CLI installation. Save your work and quit an older
Forge Desktop before installing an update.

Forge configuration, credentials, sessions, and traces use `%USERPROFILE%\.forge`
by default; `FORGE_HOME` can override it. Native Forge provider credentials and
Codex authentication remain separate. Codex CLI is not bundled: install it
separately and make `codex` available in the app's inherited `PATH`, or set
`FORGE_CODEX_PATH` to the full path of the executable before launching the app.
The app reports Codex unavailability rather than switching engines.

The app checks the official Desktop releases and can download and SHA-256-verify
a newer Windows installer. Opening a verified installer does not quit the
running app or install automatically. Quit Forge Desktop before continuing in
the installer. The Windows preview has no automatic replacement or signed
update mechanism.

Windows CI builds the x64 NSIS installer, runs targeted offline tests, starts
the packaged app, and performs silent install, installed-app smoke, and
uninstall checks. These checks do not prove real provider login, every network
route, Windows ARM64 support, or a signed SmartScreen experience.
