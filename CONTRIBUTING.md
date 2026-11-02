# Contributing

Thanks for your interest in improving Claude Session Relay.

## Build and test

```powershell
npm test          # the protocol tests, plain Node, no dependencies
npm run build     # packs dist/claude-session-relay.vsix
code --install-extension dist/claude-session-relay.vsix
```

- Nothing to install: the extension, the `relay` client, the tests and the packer use only
  Node's standard library.
- The tests cover the pure part (`src/relay.js`: naming, validation, the inbox). What touches
  VS Code (`src/extension.js`) is checked by hand in a real window: open the Output channel
  *Claude Session Relay* and drive it with `node bin/relay.js`.

## Releasing

1. Bump `version` in `package.json` and move the `Unreleased` notes in `CHANGELOG.md` under
   the new version.
2. Push a `vX.Y.Z` tag. The release workflow tests, builds the VSIX and publishes a GitHub
   Release with it.
3. Publish to the Marketplace with `npx @vscode/vsce publish` (the maintainer's token).

## Style

- Follow the `.editorconfig` (2-space indent, LF). Match the surrounding code.
- Keep commit messages in the imperative mood with a short summary line.
- Do not use em-dashes or en-dashes in code, comments, or docs - plain hyphens only.

## Scope

Changes to the protocol or to `src/relay.js` should come with a test. Keep the protocol
backward compatible: a client written for an older version must keep working.
