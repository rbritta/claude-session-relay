'use strict';
/*
 * The pure part of Claude Session Relay: settings, workspace naming and the
 * request protocol. No `vscode` import here, so the tests run with plain Node.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ACTIONS = ['open', 'new', 'close', 'rename', 'tabs', 'closeWindow'];
const REQUEST = /^[\w-]+\.json$/;
const REPLY = '.done.json';

/** The default inbox: %LOCALAPPDATA%\claude-session-relay on Windows, ~/.claude-session-relay elsewhere. */
function defaultInbox(env = process.env) {
  if (env.LOCALAPPDATA) return path.join(env.LOCALAPPDATA, 'claude-session-relay');
  return path.join(os.homedir(), '.claude-session-relay');
}

/** `~` and `%VAR%` / `${env:VAR}` in a configured path. */
function expand(p, env = process.env) {
  if (!p) return p;
  return String(p)
    .replace(/^~(?=$|[\\/])/, os.homedir())
    .replace(/%([A-Za-z_][\w]*)%/g, (m, k) => (env[k] !== undefined ? env[k] : m))
    .replace(/\$\{env:([A-Za-z_][\w]*)\}/g, (m, k) => (env[k] !== undefined ? env[k] : m));
}

/**
 * The name a window answers to. `rules` are tried in order against each open
 * folder: `{ pattern, name }`, where `pattern` is a case-insensitive regular
 * expression over the folder path and `name` may use `$1`... Without a match the
 * name is the first folder's base name, lower-cased, unless `onlyMatching`.
 */
function workspaceName(folders, rules = [], onlyMatching = false) {
  for (const f of folders) {
    for (const r of rules || []) {
      let re;
      try { re = new RegExp(r.pattern, 'i'); } catch (_) { continue; }
      const m = re.exec(f);
      if (m) return sanitize(String(r.name || '$0').replace(/\$(\d)/g, (_, i) => m[Number(i)] || ''));
    }
  }
  if (onlyMatching || !folders.length) return null;
  // split on both separators: a Windows path is not split by path.basename on Linux
  return sanitize(folders[0].replace(/[\\/]+$/, '').split(/[\\/]/).pop());
}

const sanitize = (s) => {
  const v = String(s).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return v || null;
};

/** Does this window run under the Claude account the settings ask for? Empty pattern = any. */
function accountMatches(pattern, configDir = process.env.CLAUDE_CONFIG_DIR || '') {
  if (!pattern) return true;
  try { return new RegExp(pattern, 'i').test(configDir); } catch (_) { return false; }
}

/**
 * A request, validated. Returns `{ action, session, prompt, name, start }` or throws.
 * `open` without a session is the same as `new`. `start` (only for a new
 * conversation with a prompt) sends the prompt instead of just typing it in.
 */
function parseRequest(p) {
  if (!p || typeof p !== 'object') throw new Error('request is not an object');
  const action = String(p.action || '');
  if (!ACTIONS.includes(action)) throw new Error(`unknown action: ${action || '(none)'}`);
  const session = p.session == null || p.session === '' ? null : String(p.session);
  if (session !== null && !UUID.test(session)) throw new Error('session must be a UUID');
  if (['close', 'rename'].includes(action) && !session) throw new Error(`${action} needs a session`);
  const prompt = p.prompt == null ? null : String(p.prompt);
  const name = p.name == null ? null : String(p.name).trim();
  if (action === 'rename' && !name) throw new Error('rename needs a name');
  const act = action === 'open' && !session ? 'new' : action;
  const start = p.start === true;
  if (start && act !== 'new') throw new Error('start is only for a new conversation');
  if (start && !(prompt || '').trim()) throw new Error('start needs a prompt');
  return { action: act, session, prompt, name, start };
}

/** Request files waiting in a workspace's inbox, oldest id first. */
const pending = (dir) => fs.readdirSync(dir).filter((f) => REQUEST.test(f) && !f.endsWith(REPLY)).sort();

/** Writes a file so a reader never sees half of it: tmp + rename. Readable by its owner only. */
function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, typeof data === 'string' ? data : JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/**
 * Creates a folder only its owner can enter. With `narrow`, on Linux and macOS an
 * existing one is narrowed too: the heartbeat lists folders and tab titles, and
 * whoever can write here can type prompts. Windows keeps the profile's own
 * permissions.
 */
function ensurePrivateDir(dir, { narrow = true, platform = process.platform } = {}) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (narrow && platform !== 'win32') fs.chmodSync(dir, 0o700);
}

const STALE_REQUEST_MS = 5 * 60 * 1000;
const STALE_REPLY_MS = 10 * 60 * 1000;

/**
 * Removes what nobody will read: replies and leftover temp files older than
 * `replyMs` (the client that asked is gone). Returns the names removed.
 */
function sweep(dir, { now = Date.now(), replyMs = STALE_REPLY_MS } = {}) {
  const gone = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(REPLY) && !f.endsWith('.tmp')) continue;
    const p = path.join(dir, f);
    try {
      if (now - fs.statSync(p).mtimeMs > replyMs) { fs.unlinkSync(p); gone.push(f); }
    } catch (_) { /* taken meanwhile */ }
  }
  return gone;
}

/**
 * Takes a request out of the inbox. The unlink is the claim: when two windows
 * share a name, the one that deletes the file does the work.
 */
function claim(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (_) { return null; }
  let body;
  try { body = JSON.parse(raw); } catch (_) { return null; } // still being written: next round
  try { fs.unlinkSync(file); } catch (_) { return null; } // another window got it
  return body;
}

/**
 * One pass over a workspace's inbox: claims each request in id order, runs it
 * through `perform` and writes the reply (with whatever object `perform`
 * returns, such as the session a started conversation got). A request older than `staleMs` is
 * answered with an error and not run, so a window opened later does not act on
 * something its client gave up on. Returns `'closeWindow'` when a close-window
 * request succeeded: its reply is already written and the rest waits for the
 * next window.
 */
async function serveOnce(dir, perform, { tabs = () => [], log = () => {}, onReply = () => {}, now = Date.now, staleMs = STALE_REQUEST_MS } = {}) {
  for (const f of pending(dir)) {
    const id = f.slice(0, -5);
    const file = path.join(dir, f);
    let age = 0;
    try { age = now() - fs.statSync(file).mtimeMs; } catch (_) { continue; }
    const body = claim(file);
    if (!body) continue;
    let error = null;
    let r = null;
    let result = null;
    try {
      r = parseRequest(body);
      if (age > staleMs) throw new Error(`expired: waited ${Math.round(age / 1000)}s for a window`);
      result = await perform(r, id);
    } catch (e) { error = e.message; }
    log(`${id} ${body.action}${error ? ` failed: ${error}` : ' ok'}`);
    const extra = result && typeof result === 'object' && !Array.isArray(result) ? result : {};
    writeAtomic(path.join(dir, `${id}${REPLY}`), { ok: !error, error, ...extra, tabs: tabs() });
    onReply();
    if (!error && r.action === 'closeWindow') return 'closeWindow';
  }
  return null;
}

/**
 * Starts a new conversation with `prompt` already sent: leaves the prompt in
 * <dir>/starts/p-<id>.json, opens an empty tab with `openTab` and waits for the
 * auto-start hook (src/hook.js) running in the new conversation to claim it.
 * Resolves `{ started: true, session }`; throws when no conversation took it in
 * `waitMs` (the prompt is withdrawn, so a later conversation does not get it).
 */
async function startConversation(dir, id, prompt, openTab, { waitMs = 30000, pollMs = 250 } = {}) {
  const starts = path.join(dir, 'starts');
  ensurePrivateDir(starts);
  const pendingFile = path.join(starts, `p-${id}.json`);
  const sidFile = path.join(starts, `p-${id}.sid`);
  writeAtomic(pendingFile, { request: id, prompt, at: new Date().toISOString() });
  await openTab();
  const end = Date.now() + waitMs;
  while (Date.now() < end) {
    await new Promise((r) => setTimeout(r, pollMs));
    let session = null;
    try { session = fs.readFileSync(sidFile, 'utf8').trim(); } catch (_) { continue; }
    try { fs.unlinkSync(sidFile); } catch (_) { /* gone */ }
    return { started: true, session };
  }
  try { fs.unlinkSync(pendingFile); } catch (_) { /* claimed at the last moment */ }
  throw new Error(`the new conversation did not pick up the prompt in ${Math.round(waitMs / 1000)}s (is the auto-start hook installed? see "relay hook status")`);
}

module.exports = {
  UUID, ACTIONS, REPLY, STALE_REQUEST_MS, STALE_REPLY_MS,
  defaultInbox, expand, workspaceName, accountMatches, parseRequest, pending, writeAtomic, ensurePrivateDir, claim, sweep, serveOnce, startConversation,
};
