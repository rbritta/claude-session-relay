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
    starts/                            auto-start: prompts waiting for a new conversation
  hook.js                              auto-start: the hook Claude Code runs (a copy kept by the extension)
```

- **`<workspace>`** is the window's name: the first `claudeSessionRelay.workspaces` rule
  that matches one of its folders, else the first folder's base name. Names are
  lower-cased and reduced to `a-z 0-9 . _ -`. The rule is a shared convention: a list of
  `{ "pattern": <regex over the folder path>, "name": <text that may use $1> }`, tried in order,
  first match wins. Other tools that name the same workspaces (ai-signalbox's `workspaces`
  config) read the same rule, so one list written once names a folder the same way in both.
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
| `prompt` | `new`, `open` | Text typed into the conversation's input box. Not sent, unless `start`. |
| `name` | `rename` | The new tab title. |
| `start` | `new` | `true` sends `prompt` instead of typing it: the conversation starts working on its own. Needs a prompt and the auto-start hook (see [Auto-start](#auto-start)). |

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
Since 0.1.1 the window also refuses a request whose file is more than 5 minutes old: it is
answered `{ "ok": false, "error": "expired: ..." }` and not run.

Replies nobody read and leftover `.tmp` files older than 10 minutes are removed by the window.

A `new` with `start` adds what happened to the prompt:

```json
{ "ok": true, "error": null, "started": true, "session": "3007172c-30ed-48a3-a551-fc7a288b219d", "tabs": [...] }
```

| `started` | |
|---|---|
| `true` | The conversation `session` received the prompt and is working on it. |
| `false` | The auto-start hook is not installed: the prompt was typed in, as without `start`, and `note` says how to install the hook. |

If the hook is installed but no new conversation took the prompt within 30 seconds, the
reply is `{ "ok": false, "error": "the new conversation did not pick up the prompt..." }`
and the prompt is withdrawn. A client waiting for a `start` should allow about 45 seconds.

## Auto-start

Claude Code hooks are commands Claude Code runs at fixed moments. Auto-start uses two of
them, both `node "<root>/hook.js" ...`, written to Claude Code's user settings by
*Claude Session Relay: Install auto-start hook* or `relay hook install`:

| Step | Who | What |
|---|---|---|
| 1 | window | Writes `<workspace>/starts/p-<id>.json` (`{ request, prompt, at }`) and opens an empty Claude tab. |
| 2 | `hook.js start` (`SessionStart`, source `startup` only) | In the new conversation: finds the window whose folder holds its working directory, renames the oldest prompt younger than 2 minutes to `starts/<session>.json` (the rename is the claim), writes `starts/p-<id>.sid` with the session id and returns `watchPaths` with that file. A detached `hook.js touch` rewrites the file 3, 8 and 20 seconds later, once Claude Code watches it. |
| 3 | `hook.js wake` (`FileChanged`, `asyncRewake`) | Sees its own `starts/<session>.json`, creates `starts/<session>.claimed` exclusively (the claim), rewrites the file in place as `{}` and exits 2 with the prompt on stderr: Claude Code hands it to the conversation as the thing to work on. The watched file is never removed or renamed, because Claude Code keeps one watcher per conversation, shared with other tools' hooks. A delivered file and its marker are removed after 7 days, the next time a start is claimed in that window. |
| 4 | window | Reads `p-<id>.sid`, deletes it and replies `started: true` with the session. |

Every command carries the tag `#claude-session-relay` at the end (a comment in a POSIX
shell, an ignored argument elsewhere); it is how `install` and `remove` find their own
entries without touching anything else. Removing the hook leaves `hook.js` in the root; it
does nothing unless the settings call it.

## Permissions

On Linux and macOS the window creates `<root>` and `<workspace>` as `0700` (an existing
`<workspace>` folder is narrowed to `0700`; a `<root>` you chose is left as it is) and writes its
files as `0600`. On Windows the folders inherit the permissions of the user profile.

## Heartbeat

`.window.json` is rewritten every 5 seconds and after each request, and removed when the
window closes cleanly:

```json
{
  "workspace": "my-api",
  "folders": ["C:\\src\\My API"],
  "pid": 12345,
  "version": "0.2.0",
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
