# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_No unreleased changes yet._

## [0.2.1] - 2026-11-14

### Fixed
- **Auto-start no longer deletes the file Claude Code watches.** Claude Code keeps one file watcher per
  conversation, shared by every hook that asks for one; deleting the start file after the wake could take
  that watcher down for another tool watching in the same conversation. The wake now claims the file with an
  exclusive `<session>.claimed` marker and empties it in place; delivered files and markers are removed after
  7 days.

### Documentation
- The workspace naming rule (`{ pattern, name }`, first match wins) is documented as a shared convention that
  other tools naming the same folders can read.

## [0.2.0] - 2026-11-04

### Added
- **Auto-start.** `new` with `"start": true` sends the prompt instead of typing it in: the
  conversation starts working on its own, and the reply carries `started` and the new
  `session` id. It works through an opt-in Claude Code hook (`src/hook.js`), installed with the
  command *Claude Session Relay: Install auto-start hook* or `relay hook install`, and removed
  the same way. The hook acts only in a conversation that was just opened with a prompt waiting
  for it; everything else finds nothing to do.
- `relay new ... --start` and `relay hook install | remove | status`.
- A reply can carry what the action returned (`started`, `session`, `note`).

## [0.1.1] - 2026-11-04

### Security
- The inbox folder of each window, and the files in it, are now readable by their owner only on
  Linux and macOS. Before, other users of the machine could read the heartbeat (folders and tab
  titles), and a world-writable inbox let them queue requests.
- CI runs with a read-only token, actions are pinned to commit SHAs, and Dependabot keeps them
  current.

### Changed
- A request that waited more than 5 minutes for a window is answered `expired: ...` instead of
  being run, so a window opened later does not act on something its client gave up on.
- Replies nobody read and leftover temp files are removed after 10 minutes.

### Fixed
- The fallback window name is the folder's base name on every OS (a Windows path read on Linux
  kept the whole path).

### Added
- Tests for the request loop (order, errors, close-window, expiry, two windows with one name) and
  for the `relay` command line against a simulated window, run on Linux, Windows and macOS.

## [0.1.0] - 2026-11-02

### Added
- A file inbox per VS Code window, named after its folder or by `claudeSessionRelay.workspaces`
  rules.
- Actions `new`, `open`, `close`, `rename`, `tabs` and `closeWindow` over the Claude Code tabs
  of the window. `new` and `open` can type a prompt into the input box.
- A heartbeat file per window (`.window.json`) with its folders, account, focus and tabs.
- The `relay` command line client.
- `claudeSessionRelay.claudeConfigDir` to listen only under one Claude account.
