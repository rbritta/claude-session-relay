<div align="center">

<img src="docs/logo.png" width="120" alt="Claude Session Relay logo" />

# Claude Session Relay

**Drive the Claude Code tabs of any VS Code window from a script, a bot or a web panel.**

[![build](https://github.com/rbritta/claude-session-relay/actions/workflows/build.yml/badge.svg)](https://github.com/rbritta/claude-session-relay/actions/workflows/build.yml)
[![release](https://img.shields.io/github/v/release/rbritta/claude-session-relay?sort=semver&color=e27350)](https://github.com/rbritta/claude-session-relay/releases/latest)
[![downloads](https://img.shields.io/github/downloads/rbritta/claude-session-relay/total?color=4ca54c)](https://github.com/rbritta/claude-session-relay/releases)
[![license: MIT](https://img.shields.io/badge/license-MIT-e8b74e.svg)](LICENSE)

</div>

---

You run several VS Code windows, one per project, each with its own
[Claude Code](https://docs.anthropic.com/en/docs/claude-code) conversations. Something
outside VS Code - a chat bot, a cron job, a dashboard on your phone - decides that one
of them should pick up a task. **Claude Session Relay** gives every window a small
**file inbox**: drop a JSON request there and that window opens a conversation with the
task already typed, brings an old one back, renames or closes a tab - no matter which
window has focus, with no `vscode://` link and no permission prompt.

It is deliberately boring: plain files, no server, no port, no network. Anything that
can write a file can use it.

## What it does

| Action | What happens in the window |
|---|---|
| `new` | A new Claude Code conversation, with `prompt` typed in its input box. You read it and press Enter. |
| `open` | Brings the `session` tab to the front, or reopens a closed one (same id, like `/resume`). With `prompt`, types it in. |
| `close` | Closes only that conversation's tab; the window stays. |
| `rename` | Gives the tab a name (for example a ticket number and status), through Claude Code's own *Rename Session Tab*. |
| `tabs` | Just answers with the Claude tabs that are open. |
| `closeWindow` | Closes the whole window, after replying. |

Every reply carries the list of Claude tabs in the window, and each window keeps a
heartbeat file saying who it is, which folders it has open and what tabs it shows - so
a panel can list your sessions without asking.

## Quick start

**1. Install** (PowerShell; downloads the latest release and installs it into VS Code):

```powershell
irm https://raw.githubusercontent.com/rbritta/claude-session-relay/main/install.ps1 -OutFile "$env:TEMP\csr.ps1"; & "$env:TEMP\csr.ps1"
```

Or download `claude-session-relay.vsix` from the
[latest release](https://github.com/rbritta/claude-session-relay/releases/latest) and run
`code --install-extension claude-session-relay.vsix`.

**2. Open a project window.** It starts listening as the folder's name (lower-cased),
for example `my-api` for `C:\src\My API`. *View > Output > Claude Session Relay*
shows the name and the inbox.

**3. Send it something:**

```powershell
node bin/relay.js list
node bin/relay.js new my-api --prompt "Run the tests and fix what fails"
```

A new Claude tab opens in that window with the prompt in the box.

## The protocol in one minute

```
%LOCALAPPDATA%\claude-session-relay\        (~/.claude-session-relay elsewhere)
  my-api\
    .window.json                 the window that listens here: pid, folders, tabs, heartbeat
    1730518211000-a1b2c3.json    a request:  { "action": "new", "prompt": "..." }
    1730518211000-a1b2c3.done.json   the reply: { "ok": true, "error": null, "tabs": [...] }
```

Write the request atomically (to a temp name, then rename), poll for `<id>.done.json`,
delete it when read. The window picks requests up within a second. Full details,
including every field, are in [docs/PROTOCOL.md](docs/PROTOCOL.md).

## Settings

| Setting | Default | |
|---|---|---|
| `claudeSessionRelay.enabled` | `true` | Listen in this window. |
| `claudeSessionRelay.inbox` | *(empty)* | Root folder of the inboxes. `~`, `%VAR%` and `${env:VAR}` are expanded. |
| `claudeSessionRelay.workspaces` | `[]` | Naming rules, tried in order: `{ "pattern": "<regex over the folder path>", "name": "<may use $1>" }`. |
| `claudeSessionRelay.onlyMatchingWorkspaces` | `false` | Listen only in windows that match a rule. |
| `claudeSessionRelay.claudeConfigDir` | *(empty)* | Listen only when `CLAUDE_CONFIG_DIR` matches this regex - handy when one machine runs two Claude accounts (work and personal) in separate VS Code profiles. |

Example: numbered work environments, and nothing else.

```jsonc
"claudeSessionRelay.workspaces": [{ "pattern": "^[a-z]:\\\\dev\\\\(env\\d+)", "name": "$1" }],
"claudeSessionRelay.onlyMatchingWorkspaces": true
```

## Requirements

- **VS Code 1.90+** with the **Claude Code** extension (`anthropic.claude-code`).
- **Node.js** for the `relay` command line (optional; any language can write the files).

## Important considerations

- **The prompt is typed, not sent.** Claude Code fills the input box; a person presses
  Enter. That keeps a human on the trigger of every delegated task. If you want an
  unattended first turn, run it with `claude -p --session-id <uuid> "..."` and then
  `open` that session to continue it in the tab.
- **Anyone who can write to the inbox can drive your tabs.** The inbox lives in your
  user profile (private to you on Linux and macOS); do not point it at a shared or synced
  folder. See [SECURITY.md](SECURITY.md).
- **Requests expire.** A request no window took within 5 minutes is answered `expired` and
  not run, so opening a window later never replays old work. Unread replies are removed
  after 10 minutes. See [docs/PROTOCOL.md](docs/PROTOCOL.md).
- **Rename needs an idle window.** It goes through the clipboard (restored afterwards)
  and a quick-pick, so it refuses while the window has focus; try again a minute later.
- **Not an Anthropic product.** This is a community extension that uses the public
  commands of the Claude Code extension; those commands may change between releases.

## Contributing

Issues and pull requests are welcome - see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © Romulo Britta
