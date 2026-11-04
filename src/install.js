'use strict';
/*
 * Installs and removes the auto-start hook (src/hook.js) in Claude Code's user
 * settings. Pure Node, so the command line, the extension and the tests share it.
 *
 * What it writes to <claude config dir>/settings.json, next to whatever hooks
 * are already there:
 *
 *   SessionStart: node "<inbox>/hook.js" start #claude-session-relay
 *   FileChanged:  node "<inbox>/hook.js" wake #claude-session-relay   (asyncRewake)
 *
 * (In a POSIX shell the tag is a comment; elsewhere it is an extra argument.
 * Either way the hook ignores it.)
 *
 * The hook runs from a copy at <inbox>/hook.js, so the settings keep working
 * when the extension updates (its own folder name changes with the version).
 * Each command ends with the tag "#claude-session-relay" (an argument the hook
 * ignores), which is how our entries are told apart from everything else.
 * The settings file is backed up once, to settings.json.relay-backup, before
 * the first change; nothing but our entries is touched.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOK_SOURCE = path.join(__dirname, 'hook.js');
/* every command we write ends with this tag (an argument the hook ignores), wherever the inbox lives */
const TAG = '#claude-session-relay';
const OURS = /hook\.js"? (start|wake) #claude-session-relay$/;

/** Claude Code's user config folder: CLAUDE_CONFIG_DIR, else ~/.claude. */
const configDir = (env = process.env) => env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const settingsFile = (dir) => path.join(dir, 'settings.json');
const hookFile = (inbox) => path.join(inbox, 'hook.js');

function readSettings(file) {
  if (!fs.existsSync(file)) return {};
  const raw = fs.readFileSync(file, 'utf8');
  if (!raw.trim()) return {};
  try { return JSON.parse(raw); } catch (e) { throw new Error(`${file} is not valid JSON, left untouched: ${e.message}`); }
}

const isOurs = (h) => !!h && typeof h.command === 'string' && OURS.test(h.command);

/** The two entries, for the hook copy at `hookPath`. */
function entries(hookPath) {
  const cmd = (a) => `node "${hookPath.replace(/\\/g, '/')}" ${a} ${TAG}`;
  return {
    SessionStart: { hooks: [{ type: 'command', command: cmd('start'), timeout: 10 }] },
    FileChanged: {
      hooks: [{
        type: 'command', command: cmd('wake'), asyncRewake: true, timeout: 15,
        rewakeMessage: 'Claude Session Relay: this conversation was opened to work on the request below.',
        rewakeSummary: 'relay: start prompt',
      }],
    },
  };
}

/** The settings without our entries (groups left empty by that are dropped too). */
function withoutHook(settings) {
  const s = JSON.parse(JSON.stringify(settings || {}));
  if (!s.hooks) return s;
  for (const ev of Object.keys(s.hooks)) {
    if (!Array.isArray(s.hooks[ev])) continue;
    s.hooks[ev] = s.hooks[ev]
      .map((g) => (g && Array.isArray(g.hooks) ? { ...g, hooks: g.hooks.filter((h) => !isOurs(h)) } : g))
      .filter((g) => !(g && Array.isArray(g.hooks) && !g.hooks.length));
    if (!s.hooks[ev].length) delete s.hooks[ev];
  }
  if (!Object.keys(s.hooks).length) delete s.hooks;
  return s;
}

/** The settings with our entries, exactly once, after the user's own. */
function withHook(settings, hookPath) {
  const s = withoutHook(settings);
  s.hooks = s.hooks || {};
  for (const [ev, group] of Object.entries(entries(hookPath))) s.hooks[ev] = [...(s.hooks[ev] || []), group];
  return s;
}

const isInstalled = (settings) => Object.values((settings && settings.hooks) || {})
  .some((groups) => Array.isArray(groups) && groups.some((g) => g && Array.isArray(g.hooks) && g.hooks.some(isOurs)));

function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

function backupOnce(file) {
  const bak = `${file}.relay-backup`;
  if (fs.existsSync(file) && !fs.existsSync(bak)) fs.copyFileSync(file, bak);
  return bak;
}

/** Copies the hook next to the inbox (always: keeps it current with the extension). */
function refreshHook(inbox) {
  fs.mkdirSync(inbox, { recursive: true });
  const to = hookFile(inbox);
  const src = fs.readFileSync(HOOK_SOURCE);
  if (!fs.existsSync(to) || !fs.readFileSync(to).equals(src)) fs.writeFileSync(to, src);
  return to;
}

/** Installs the hook. Returns what it did, for the caller to tell the user. */
function install({ inbox, claudeDir = configDir() }) {
  const file = settingsFile(claudeDir);
  const before = readSettings(file);
  const hook = refreshHook(inbox);
  const after = withHook(before, hook);
  const changed = JSON.stringify(before) !== JSON.stringify(after);
  let backup = null;
  if (changed) { backup = fs.existsSync(file) ? backupOnce(file) : null; write(file, after); }
  return { installed: true, changed, settings: file, hook, backup };
}

/** Removes our entries. The hook copy stays (harmless; the extension refreshes it). */
function uninstall({ claudeDir = configDir() } = {}) {
  const file = settingsFile(claudeDir);
  const before = readSettings(file);
  const after = withoutHook(before);
  const changed = JSON.stringify(before) !== JSON.stringify(after);
  if (changed) write(file, after);
  return { installed: false, changed, settings: file };
}

function status({ claudeDir = configDir() } = {}) {
  const file = settingsFile(claudeDir);
  let installed = false, error = null;
  try { installed = isInstalled(readSettings(file)); } catch (e) { error = e.message; }
  return { installed, settings: file, error };
}

module.exports = { HOOK_SOURCE, configDir, settingsFile, hookFile, readSettings, entries, withHook, withoutHook, isInstalled, refreshHook, install, uninstall, status };
