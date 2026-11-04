#!/usr/bin/env node
'use strict';
/*
 * The auto-start hook of Claude Session Relay: lets a request start a new
 * conversation with its prompt, without anyone pressing Enter.
 *
 * VS Code can open a Claude Code tab with text in its input box, but nothing
 * can press Enter for you. Claude Code hooks can, though: a FileChanged hook
 * marked `asyncRewake` that exits with code 2 wakes the session with its
 * stderr as the next thing to act on, even before the first turn. So:
 *
 *   1. The window writes the prompt to <inbox>/<workspace>/starts/p-<id>.json
 *      and opens an empty Claude Code tab.
 *   2. `hook.js start` (SessionStart) runs in the conversation that was just
 *      born, claims that file by renaming it to <session>.json, tells the window
 *      which session took it (p-<id>.sid) and asks Claude Code to watch the file.
 *   3. A detached `hook.js touch` rewrites the file a few times, once Claude
 *      Code's watcher is up.
 *   4. `hook.js wake` (FileChanged) sees its own session's file, removes it and
 *      exits 2 with the prompt: the conversation starts working on it.
 *
 * Conversations you open yourself never find a file to claim, so the hook does
 * nothing in them. It needs only Node and reads the inbox it lives in (the
 * window keeps a copy at <inbox>/hook.js); RELAY_INBOX overrides that.
 *
 *   node hook.js start | wake | touch <file>
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = process.env.RELAY_INBOX || __dirname;
const PENDING = /^p-[\w-]+\.json$/;
const FRESH_MS = 2 * 60 * 1000; // a start nobody claimed in this time belongs to nobody
const TOUCHES_S = [3, 8, 20]; // the watcher comes up only after the start hook returns

const norm = (p) => {
  const v = path.resolve(String(p || '')).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? v.toLowerCase() : v;
};
const inside = (p, root) => { const a = norm(p), b = norm(root); return a === b || a.startsWith(b + path.sep); };
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return null; } };

function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, typeof data === 'string' ? data : JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/** The inbox folder of the window whose workspace holds `cwd`, or null. */
function workspaceFor(cwd, root = ROOT) {
  let names = [];
  try { names = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch (_) { return null; }
  for (const n of names) {
    const w = readJson(path.join(root, n, '.window.json'));
    if (w && (w.folders || []).some((f) => inside(cwd, f))) return path.join(root, n);
  }
  return null;
}

/**
 * Takes the oldest fresh start waiting for a new conversation in `cwd`'s window.
 * The rename is the claim: two conversations born at once cannot both get it.
 * Returns the claimed file (<starts>/<session>.json) or null.
 */
function claimStart(cwd, sid, { root = ROOT, now = Date.now() } = {}) {
  const ws = workspaceFor(cwd, root);
  if (!ws) return null;
  const dir = path.join(ws, 'starts');
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => PENDING.test(f)).sort(); } catch (_) { return null; }
  for (const f of files) {
    const from = path.join(dir, f);
    let age;
    try { age = now - fs.statSync(from).mtimeMs; } catch (_) { continue; }
    if (age > FRESH_MS) continue; // the window gives up on it and removes it
    const to = path.join(dir, `${sid}.json`);
    try { fs.renameSync(from, to); } catch (_) { continue; } // taken by another conversation
    writeAtomic(path.join(dir, `${f.slice(0, -5)}.sid`), sid);
    return to;
  }
  return null;
}

/** SessionStart: claim a start, watch it, and have it touched once the watcher is up. */
function start(input, opts = {}) {
  const sid = input.session_id;
  // only a conversation that was just born; never a resumed one, a /clear, a compaction or a subagent
  if (!sid || input.agent_id || (input.source && input.source !== 'startup')) return null;
  const file = claimStart(input.cwd || process.cwd(), sid, opts);
  if (!file) return null;
  if (!opts.noTouch) {
    spawn(process.execPath, [__filename, 'touch', file], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  }
  return { hookSpecificOutput: { hookEventName: 'SessionStart', watchPaths: [file] } };
}

/** FileChanged: this session's own start file. Returns the prompt to wake with, or null. */
function wake(input) {
  const sid = input.session_id, file = input.file_path;
  if (!sid || !file || input.agent_id) return null;
  if (path.basename(file) !== `${sid}.json` || path.basename(path.dirname(file)) !== 'starts') return null;
  const body = readJson(file);
  try { fs.unlinkSync(file); } catch (_) { return null; } // already delivered
  const prompt = body && String(body.prompt || '').trim();
  return prompt || null;
}

/** Rewrites the file in place (a rename would lose Claude Code's watcher) until the session took it. */
async function touch(file) {
  for (const s of TOUCHES_S) {
    await new Promise((r) => setTimeout(r, s * 1000));
    let raw;
    try { raw = fs.readFileSync(file, 'utf8'); } catch (_) { return; } // delivered
    try { fs.writeFileSync(file, raw); } catch (_) { return; }
  }
}

function readInput() {
  try { return JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch (_) { return {}; }
}

if (require.main === module) {
  const [cmd, arg] = process.argv.slice(2);
  try {
    if (cmd === 'start') {
      const out = start(readInput());
      if (out) process.stdout.write(JSON.stringify(out));
    } else if (cmd === 'wake') {
      const prompt = wake(readInput());
      if (prompt) { process.stderr.write(`${prompt}\n`); process.exitCode = 2; }
    } else if (cmd === 'touch' && arg) {
      touch(arg);
    }
  } catch (_) { /* a hook never breaks the conversation it runs in */ }
}

module.exports = { PENDING, FRESH_MS, workspaceFor, claimStart, start, wake, touch };
