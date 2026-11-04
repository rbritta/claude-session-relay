# Security

## Trust model

- **Whoever can write to the inbox can drive your Claude Code tabs**: open conversations,
  type prompts into them, close them. The default inbox is under your user profile
  (`%LOCALAPPDATA%\claude-session-relay`, or `~/.claude-session-relay`), which other users
  of the machine cannot write to. Do not point `claudeSessionRelay.inbox` at a shared,
  synced or network folder. On Linux and macOS each window's folder and files are private to
  their owner (`0700` / `0600`).
- **Prompts are typed, never sent.** A request can put text in the input box, but a person
  presses Enter. The extension never submits a turn, approves a tool or answers a
  permission prompt.
- Requests are validated before anything runs: the action must be one of the known six, the
  session must be a UUID, and nothing in a request is executed as a command or a path.
- `rename` borrows the clipboard for a moment and puts the previous text back.
- A request that waited more than 5 minutes is refused, so an old request is never run by a
  window opened later.
- The extension opens no port and makes no network call. It has no runtime dependencies. The heartbeat file lists the
  window's folders, so treat the inbox folder as private.

## Reporting a vulnerability

Please report suspected vulnerabilities privately via a
[GitHub security advisory](https://github.com/rbritta/claude-session-relay/security/advisories/new)
rather than a public issue. You can expect an initial response within a few days.
