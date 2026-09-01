# Forge v0.3.4 release notes

[简体中文](RELEASE_NOTES.zh-CN.md) · [Milestone 15 release gates](M15_RELEASE_GATES.md)

Forge v0.3.4 unifies model-facing file editing, makes context-mode ownership
explicit, and repairs interactive terminal lifecycle cleanup.

## User-visible changes

- New requests expose one `edit_file` tool for create, patch, and rewrite.
  Content hashes protect edits from stale reads and concurrent user changes.
- Existing v0.3.3 sessions remain readable, including historical
  `create_file` and `apply_patch` exchanges, but those legacy tools are not
  advertised for new work.
- Context modes are now named Manual and Automatic. Manual is the permanent
  default and asks before compaction; Automatic is enabled only by an explicit
  session choice or saved user default.
- Existing `warn` and `compact` configuration values normalize to `manual` and
  `automatic` while loading. The next configuration save writes canonical
  names without overwriting unrelated settings.
- The interactive CLI keeps the same facade and controls while its internals
  are divided by ownership. Repeated render, exit, and resume no longer grow
  terminal listeners.

## Compatibility and safety

Create does not overwrite, rewrite does not create, and all writes continue to
pass through normal policy and approval. Resume restores completed historical
conversation only; it does not restore approvals, pending execution, provider
continuation, or trust authority.

Automatic compaction is not enabled by upgrading. Users who want it may choose
Automatic for the current session or save it as their user default.

## Verification boundary

The reviewed [Milestone 15 gate report](M15_RELEASE_GATES.md) records the clean
implementation candidate, deterministic matrix, package install check, and
user-executed real Ghostty smoke. The separately authorized DeepSeek trials
remain development evidence and do not establish exact-release-commit model
quality. Publication is verified separately through the immutable tag workflow
and public npm installation.
