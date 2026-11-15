# Security

## Supported versions

Only the latest minor release gets fixes.

| Version | Supported |
|---|---|
| 0.3.x | yes |
| older | no |

## Trust model

- **Whoever can write to the inbox can drive your Claude Code tabs**: open conversations,
  type prompts into them, close them. The default inbox is under your user profile
  (`%LOCALAPPDATA%\claude-session-relay`, or `~/.claude-session-relay`), which other users
  of the machine cannot write to. Do not point `claudeSessionRelay.inbox` at a shared,
  synced or network folder. On Linux and macOS each window's folder and files are private to
  their owner (`0700` / `0600`).
- **Prompts are typed, not sent - unless you install auto-start.** By default a request can
  put text in the input box, but a person presses Enter. The opt-in auto-start hook changes
  that for `new` with `"start": true`: the prompt is handed to the new conversation, which
  starts working. With it installed, whoever can write to the inbox can start Claude Code
  turns as you, with your permission settings. Install it only if you trust everything that
  writes there. The hook itself reads only the inbox, acts only in a conversation that was
  just opened with a prompt waiting for it, and never approves a tool or answers a
  permission prompt. Remove it with `relay hook remove`.
- Requests are validated before anything runs: the action must be one of the known six, the
  session must be a UUID, and nothing in a request is executed as a command or a path.
- `rename` borrows the clipboard for a moment and puts the previous text back.
- A request that waited more than 5 minutes is refused, so an old request is never run by a
  window opened later.
- The extension opens no port and makes no network call. It has no runtime dependencies. The heartbeat file lists the
  window's folders, so treat the inbox folder as private.

## Reporting a vulnerability

Please report suspected vulnerabilities privately through
[GitHub private vulnerability reporting](https://github.com/rbritta/claude-session-relay/security/advisories/new)
rather than a public issue. You can expect an initial response within a few days.
