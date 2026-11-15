# TODO

The roadmap: ideas in the order they would be picked up. Nothing here is promised; an issue moves an item up.

- Rename without the clipboard, as soon as Claude Code offers a command that takes the new title (today the name goes
  in through the clipboard and a quick-pick, so rename waits for an idle window).
- Run the extension tests in a real VS Code as well (`@vscode/test-electron`), on top of the stand-in the unit tests
  use, so a change in Claude Code's commands shows up in CI.
- macOS back in the CI matrix: the private-folder code paths (`0700` / `0600`) are the Linux and macOS ones.
- `relay wait <workspace>`: block until a window of that name is listening, for scripts that open a window and then
  send it work.
