# AGENTS.md

For AI coding agents working on this repository.

## What this is

Claude Session Relay is a VS Code extension: each window watches a file inbox named after its workspace and acts on
JSON requests dropped there (open, start, rename, close a Claude Code tab, or close the window), writing a reply next
to each request and a heartbeat file saying who it is. A `relay` command line writes the requests. An opt-in Claude
Code hook (auto-start) lets a new conversation run its prompt on its own. Plain files, no server, no port, no
network, no runtime dependency.

## Layout

| Path | What |
|---|---|
| `src/extension.js` | the VS Code side: activation, the polling loop, each action mapped to Claude Code's commands, the heartbeat |
| `src/relay.js` | the pure protocol: naming, request validation, the inbox, `serveOnce`, expiry, sweeping, `startConversation` |
| `src/hook.js` | the auto-start hook Claude Code runs (`start`, `wake`), and the ai-threads handoff |
| `src/install.js` | adds and removes the hook in Claude Code's settings |
| `bin/relay.js` | the `relay` command line |
| `tools/build.js` | packs the VSIX with no dependency; `tools/release-notes.js` prints a version's CHANGELOG section |
| `test/` | `node:test` suites, one per part (`extension.test.js` runs the extension in a stand-in for the vscode api) |
| `docs/PROTOCOL.md` | the contract: folders, request and reply fields, auto-start, the heartbeat |

## Commands

```
npm test                              # node --test, every file under test/
npm run coverage                      # the same, with a coverage summary
npm run build                         # dist/claude-session-relay.vsix
node bin/relay.js list                # the command line from the checkout
node tools/release-notes.js v0.3.1    # the notes of a release
```

## Invariants

- No runtime dependency: Node's standard library and the `vscode` api only. The VSIX holds exactly the files listed
  in `tools/build.js`.
- The protocol is a contract ([docs/PROTOCOL.md](docs/PROTOCOL.md)): a client written for an older version keeps
  working. Requests are validated before anything runs; nothing in a request is executed as a command or a path.
- The prompt is typed, not sent, unless the request says `start` and the user installed the hook.
- The hook only acts in a conversation that was just opened with a prompt waiting for it; it never deletes a file
  Claude Code watches (it empties it in place) and never approves a tool.
- Inbox folders and files are private to their owner on Linux and macOS (`0700` / `0600`).
- Tests never touch the real inbox or Claude settings: temp folders and a temp `CLAUDE_CONFIG_DIR` for each test.
- The version lives in `package.json` (and `package-lock.json`); `CHANGELOG.md` has its section under `Unreleased`.
  A test checks they agree.
- English only, made-up data only, no em-dashes or en-dashes. `.editorconfig`: 2 spaces, LF (PowerShell: CRLF).
