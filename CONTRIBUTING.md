# Contributing

Thanks for your interest in improving Claude Session Relay.

## Set up, test and build

Node 22 or 24. There are no dependencies: the extension, the `relay` client, the tests and the packer use only
Node's standard library.

```powershell
git clone https://github.com/rbritta/claude-session-relay
cd claude-session-relay
npm test            # node:test, every file under test/
npm run coverage    # the same, with Node's coverage summary
npm run build       # packs dist/claude-session-relay.vsix
code --install-extension dist/claude-session-relay.vsix
```

- `test/relay.test.js` covers the pure part (`src/relay.js`: naming, validation, the inbox, the request loop
  `serveOnce`, expiry, sweeping, folder permissions).
- `test/cli.test.js` runs the `relay` command line against a simulated window (the same `serveOnce` loop with a fake
  action).
- `test/hook.test.js` runs the auto-start hook as Claude Code runs it, and its installer, in temp folders.
- `test/extension.test.js` activates `src/extension.js` in a stand-in for the VS Code api: the inbox, the heartbeat,
  each action, the settings and the hook commands.
- `test/release.test.js` covers the release notes and checks that `package.json` and `CHANGELOG.md` agree.
- No test reads or writes the real inbox or Claude settings: each one gets its own temp folders and
  `CLAUDE_CONFIG_DIR`.
- What the stand-in cannot prove is how Claude Code itself reacts to its commands. Check that by hand in a real
  window: open a throwaway folder in a new window, open the Output channel *Claude Session Relay* and drive it with
  `node bin/relay.js`.

CI runs the build and the tests on Ubuntu and Windows with Node 22 and 24.

There is no live demo: everything the extension does happens inside VS Code, and a page could only show a simulated
window.

## Pull requests

- A change to the protocol or to the code comes with a test; a bug fix with a test that fails without it.
- Add a line under `Unreleased` in [CHANGELOG.md](CHANGELOG.md).
- Keep the protocol backward compatible: a client written for an older version must keep working.
- Made-up data only (folder names, prompts, session ids) in tests, docs and examples.

## Releasing

1. Bump `version` in `package.json` (and `package-lock.json`) and move the `Unreleased` notes in `CHANGELOG.md`
   under `## [X.Y.Z] - YYYY-MM-DD`; a test checks that the two agree.
2. Push the commit and wait for CI to pass.
3. Push a `vX.Y.Z` tag. The release workflow tests, builds the VSIX and publishes a GitHub Release with it, the
   CHANGELOG section of that version as its notes (`tools/release-notes.js` refuses a tag that does not name the
   version).
4. Publish to the Marketplace with `npx @vscode/vsce publish` (the maintainer's token).

## Style

- Follow the `.editorconfig` (2-space indent, LF). Match the surrounding code.
- Commit messages in the imperative mood with a short summary line.
- Do not use em-dashes or en-dashes in code, comments, or docs - plain hyphens only.
