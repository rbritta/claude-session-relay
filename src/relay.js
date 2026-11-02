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
 * A request, validated. Returns `{ action, session, prompt, name }` or throws.
 * `open` without a session is the same as `new`.
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
  return { action: action === 'open' && !session ? 'new' : action, session, prompt, name };
}

/** Request files waiting in a workspace's inbox, oldest id first. */
const pending = (dir) => fs.readdirSync(dir).filter((f) => REQUEST.test(f) && !f.endsWith(REPLY)).sort();

/** Writes a file so a reader never sees half of it: tmp + rename. */
function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
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

module.exports = {
  UUID, ACTIONS, REPLY, defaultInbox, expand, workspaceName, accountMatches, parseRequest, pending, writeAtomic, claim,
};
