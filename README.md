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
task already typed (or already running, with auto-start), brings an old one back, renames or closes a tab - no matter which
window has focus, with no `vscode://` link and no permission prompt.

It is deliberately boring: plain files, no server, no port, no network. Anything that
can write a file can use it.

## What it does

| Action | What happens in the window |
|---|---|
| `new` | A new Claude Code conversation, with `prompt` typed in its input box: you read it and press Enter. With `"start": true` it is sent instead, and the conversation starts working on its own ([auto-start](#auto-start)). |
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

**4. Optional: let it start on its own.** In VS Code, run *Claude Session Relay: Install
auto-start hook* from the Command Palette (or `node bin/relay.js hook install`). Then:

```powershell
node bin/relay.js new my-api --prompt "Run the tests and fix what fails" --start
```

The tab opens and Claude is already working; the reply tells you the session id.

## Auto-start

VS Code can put text in Claude Code's input box, but nothing in VS Code can press Enter
for you. Claude Code itself can: a *hook* is a command Claude Code runs at fixed moments,
and one kind of hook can hand a just-opened conversation something to work on. Auto-start
uses that, and nothing else.

**What happens on `new` with `"start": true`:**

1. The window leaves the prompt in `<inbox>/<workspace>/starts/` and opens an empty tab.
2. In the conversation that was just born, the hook's `start` step (a `SessionStart` hook)
   claims that prompt and asks Claude Code to watch it.
3. The hook's `wake` step (a `FileChanged` hook with `asyncRewake`) hands the prompt to
   the conversation, which starts working. The prompt file is deleted.
4. The reply says `"started": true` and the new `"session"` id.

**What the installer changes:** two entries in Claude Code's user settings
(`~/.claude/settings.json`, or `$CLAUDE_CONFIG_DIR/settings.json`), added after your own
hooks and tagged `#claude-session-relay`:

```json
"SessionStart": [{ "hooks": [{ "type": "command", "command": "node \".../claude-session-relay/hook.js\" start #claude-session-relay" }] }],
"FileChanged":  [{ "hooks": [{ "type": "command", "command": "node \".../claude-session-relay/hook.js\" wake #claude-session-relay", "asyncRewake": true }] }]
```

The settings file is backed up once, to `settings.json.relay-backup`, before the first
change. The hook runs from a copy in the inbox folder, which the extension keeps current,
so updating the extension never breaks the settings.

**What it does not do:** it only acts in a conversation that was just opened in a window
with a prompt waiting for it. Conversations you open yourself, resumed ones, `/clear`,
compactions and subagents find nothing and the hook exits at once. A prompt no
conversation took within 30 seconds is withdrawn, so it never lands somewhere else later.

**Turn it off:** *Claude Session Relay: Remove auto-start hook*, or
`node bin/relay.js hook remove`. `relay hook status` tells you whether it is on. Without
the hook, `start` falls back to typing the prompt in, and the reply says
`"started": false` with a note.

## The protocol in one minute

```
%LOCALAPPDATA%\claude-session-relay\        (~/.claude-session-relay elsewhere)
  my-api\
    .window.json                 the window that listens here: pid, folders, tabs, heartbeat
    1730518211000-a1b2c3.json    a request:  { "action": "new", "prompt": "..." }
    1730518211000-a1b2c3.done.json   the reply: { "ok": true, "error": null, "tabs": [...] }
    starts\                      prompts waiting for a new conversation (auto-start)
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
- **Node.js** for the `relay` command line (optional; any language can write the files), and
  on the `PATH` for auto-start (Claude Code runs the hook with `node`).

## Important considerations

- **By default the prompt is typed, not sent.** Claude Code fills the input box; a person
  presses Enter. That keeps a human on the trigger. [Auto-start](#auto-start) removes that
  step on purpose: install it only if whatever writes to your inbox is something you would
  let type *and send* in your Claude Code.
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
