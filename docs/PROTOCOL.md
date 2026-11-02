# Protocol

Claude Session Relay talks through files. There is no server and no port: a client
writes a request into a window's inbox, the window acts on it and writes a reply next
to it.

## Folders

```
<root>/                                default: %LOCALAPPDATA%\claude-session-relay (Windows)
                                                 ~/.claude-session-relay (elsewhere)
  <workspace>/                         one per window name
    .window.json                       heartbeat of the window listening here
    <id>.json                          a request
    <id>.done.json                     its reply
```

- **`<workspace>`** is the window's name: the first `claudeSessionRelay.workspaces` rule
  that matches one of its folders, else the first folder's base name. Names are
  lower-cased and reduced to `a-z 0-9 . _ -`.
- **`<id>`** is any string of `A-Z a-z 0-9 _ -`. Requests are handled in `id` order, so a
  timestamp prefix (`1730518211000-a1b2c3`) keeps them first-in, first-out.

## Request

```json
{ "action": "new", "session": null, "prompt": "Run the tests", "name": null }
```

| Field | Used by | |
|---|---|---|
| `action` | all | `new`, `open`, `close`, `rename`, `tabs`, `closeWindow` |
| `session` | `open`, `close`, `rename` | Claude Code session id (a UUID). `open` without it is `new`. |
| `prompt` | `new`, `open` | Text typed into the conversation's input box. Not sent. |
| `name` | `rename` | The new tab title. |

Write it atomically - to `<id>.json.tmp`, then rename to `<id>.json` - so the window
never reads half a file. (A half-written file is left alone and retried on the next
round, but renaming is cleaner.)

## Reply

```json
{ "ok": true, "error": null, "tabs": [{ "label": "Fix flaky tests", "active": true }] }
```

The window deletes the request when it takes it (the delete is the claim: if two
windows share a name, only one acts) and writes `<id>.done.json` atomically. The client
reads it and deletes it. `tabs` are the Claude Code tabs of the window after the action.

A request nobody answers stays in the folder. The bundled `relay` client deletes its own
request after `--timeout` seconds so a window opened later does not act on something old.

## Heartbeat

`.window.json` is rewritten every 5 seconds and after each request, and removed when the
window closes cleanly:

```json
{
  "workspace": "my-api",
  "folders": ["C:\\src\\My API"],
  "pid": 12345,
  "version": "0.1.0",
  "account": "C:\\Users\\me\\.claude",
  "focused": false,
  "tabs": [{ "label": "Fix flaky tests", "active": true }],
  "at": "2026-11-02T03:30:00.000Z"
}
```

Treat a heartbeat older than ~20 seconds as a window that is gone (crashed, or the
machine slept).

## Client in a few lines

```js
const fs = require('fs'), path = require('path');
const dir = path.join(process.env.LOCALAPPDATA, 'claude-session-relay', 'my-api');
const id = `${Date.now()}-x`;
fs.writeFileSync(path.join(dir, `${id}.json.tmp`), JSON.stringify({ action: 'new', prompt: 'Hello' }));
fs.renameSync(path.join(dir, `${id}.json.tmp`), path.join(dir, `${id}.json`));
// poll for path.join(dir, `${id}.done.json`), read it, delete it
```
