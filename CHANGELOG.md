# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_No unreleased changes yet._

## [0.1.0] - 2026-11-02

### Added
- A file inbox per VS Code window, named after its folder or by `claudeSessionRelay.workspaces`
  rules.
- Actions `new`, `open`, `close`, `rename`, `tabs` and `closeWindow` over the Claude Code tabs
  of the window. `new` and `open` can type a prompt into the input box.
- A heartbeat file per window (`.window.json`) with its folders, account, focus and tabs.
- The `relay` command line client.
- `claudeSessionRelay.claudeConfigDir` to listen only under one Claude account.
