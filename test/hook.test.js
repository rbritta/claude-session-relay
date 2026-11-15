'use strict';
/*
 * Auto-start: the hook (src/hook.js), its installer (src/install.js) and
 * relay.startConversation, with node:test: node --test test/
 *
 * Nothing here touches the real Claude settings or inbox: every test gets its
 * own temp folders, and the hook is run as Claude Code runs it (a child process
 * with the event JSON on stdin).
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { test } = require('node:test');
const relay = require('../src/relay');
const hook = require('../src/hook');
const installer = require('../src/install');

const SID = '3007172c-30ed-48a3-a551-fc7a288b219d';
const SID2 = '8b0c1f8e-5d0a-4a0e-9a59-3a3c5b1f0e11';
const HOOK = path.join(__dirname, '..', 'src', 'hook.js');
const BIN = path.join(__dirname, '..', 'bin', 'relay.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'csr-hook-'));

/* an inbox with one window, "api", whose workspace folder is `project` */
function inbox() {
  const root = tmp(), project = tmp();
  const ws = path.join(root, 'api');
  relay.ensurePrivateDir(ws);
  relay.writeAtomic(path.join(ws, '.window.json'), { workspace: 'api', folders: [project], at: new Date().toISOString() });
  return { root, project, ws, starts: path.join(ws, 'starts') };
}
const leave = (ib, id, prompt) => {
  relay.ensurePrivateDir(ib.starts);
  relay.writeAtomic(path.join(ib.starts, `p-${id}.json`), { request: id, prompt });
};
const runHook = (args, input, root) => spawnSync(process.execPath, [HOOK, ...args], {
  input: JSON.stringify(input), env: { ...process.env, RELAY_INBOX: root }, encoding: 'utf8',
});

test('a conversation born in the window claims the waiting prompt and tells the window who took it', () => {
  const ib = inbox();
  leave(ib, '1-a', 'Run the tests');
  const out = hook.start({ session_id: SID, cwd: path.join(ib.project, 'src'), source: 'startup' }, { root: ib.root, noTouch: true });
  const file = path.join(ib.starts, `${SID}.json`);
  assert.deepStrictEqual(out.hookSpecificOutput.watchPaths, [file]);
  assert.strictEqual(fs.readFileSync(path.join(ib.starts, 'p-1-a.sid'), 'utf8'), SID);
  assert.ok(!fs.existsSync(path.join(ib.starts, 'p-1-a.json')));
});

test('only one of two conversations born at once gets the prompt', () => {
  const ib = inbox();
  leave(ib, '1-a', 'Only once');
  const a = hook.start({ session_id: SID, cwd: ib.project, source: 'startup' }, { root: ib.root, noTouch: true });
  const b = hook.start({ session_id: SID2, cwd: ib.project, source: 'startup' }, { root: ib.root, noTouch: true });
  assert.ok(a && !b);
});

test('resumed, cleared or compacted conversations, subagents and other folders are left alone', () => {
  const ib = inbox();
  leave(ib, '1-a', 'Not for you');
  for (const source of ['resume', 'clear', 'compact']) {
    assert.strictEqual(hook.start({ session_id: SID, cwd: ib.project, source }, { root: ib.root, noTouch: true }), null, source);
  }
  assert.strictEqual(hook.start({ session_id: SID, cwd: ib.project, source: 'startup', agent_id: 'x' }, { root: ib.root, noTouch: true }), null);
  assert.strictEqual(hook.start({ session_id: SID, cwd: tmp(), source: 'startup' }, { root: ib.root, noTouch: true }), null);
  assert.ok(fs.existsSync(path.join(ib.starts, 'p-1-a.json')), 'still waiting');
});

test('a prompt nobody claimed in time is not given to a later conversation', () => {
  const ib = inbox();
  leave(ib, '1-a', 'Too old');
  const later = Date.now() + hook.FRESH_MS + 1000;
  assert.strictEqual(hook.claimStart(ib.project, SID, { root: ib.root, now: later }), null);
});

test('wake delivers the prompt once, only to its own conversation', () => {
  const ib = inbox();
  leave(ib, '1-a', 'Run the tests');
  hook.start({ session_id: SID, cwd: ib.project, source: 'startup' }, { root: ib.root, noTouch: true });
  const file = path.join(ib.starts, `${SID}.json`);
  assert.strictEqual(hook.wake({ session_id: SID2, file_path: file }), null, 'another conversation');
  assert.strictEqual(hook.wake({ session_id: SID, file_path: path.join(ib.ws, `${SID}.json`) }), null, 'not a starts file');
  assert.strictEqual(hook.wake({ session_id: SID, file_path: file }), 'Run the tests');
  assert.strictEqual(hook.wake({ session_id: SID, file_path: file }), null, 'already delivered');
});

test('wake never removes the watched file: it stays, emptied in place, beside the delivered marker', () => {
  const ib = inbox();
  leave(ib, '1-a', 'Run the tests');
  hook.start({ session_id: SID, cwd: ib.project, source: 'startup' }, { root: ib.root, noTouch: true });
  const file = path.join(ib.starts, `${SID}.json`);
  assert.strictEqual(hook.wake({ session_id: SID, file_path: file }), 'Run the tests');
  assert.strictEqual(fs.readFileSync(file, 'utf8'), '{}', 'the watched file is still there, emptied');
  assert.ok(fs.existsSync(path.join(ib.starts, `${SID}.claimed`)), 'the marker says it was delivered');
  // the rewrite fires FileChanged again: nothing to deliver, nothing changes
  assert.strictEqual(hook.wake({ session_id: SID, file_path: file }), null);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), '{}');
});

test('delivered start files go after 7 days, fresh ones and waiting prompts stay', () => {
  const ib = inbox();
  leave(ib, '1-a', 'Run the tests');
  hook.start({ session_id: SID, cwd: ib.project, source: 'startup' }, { root: ib.root, noTouch: true });
  hook.wake({ session_id: SID, file_path: path.join(ib.starts, `${SID}.json`) });
  leave(ib, '2-b', 'Another prompt');
  const now = Date.now();
  assert.deepStrictEqual(hook.pruneDelivered(ib.starts, now + hook.DELIVERED_MS - 60000), [], 'a week not yet passed');
  assert.deepStrictEqual(hook.pruneDelivered(ib.starts, now + hook.DELIVERED_MS + 60000), [`${SID}.claimed`]);
  // p-1-a.sid is the window's to read and remove (startConversation); no window runs here
  assert.deepStrictEqual(fs.readdirSync(ib.starts).filter((f) => !f.endsWith('.sid')).sort(), ['p-2-b.json'],
    'the delivered file and its marker went, the waiting prompt stayed');
});

test('with ai-threads, start hands the claimed prompt over, marks it delivered and arms no watch of its own', () => {
  const ib = inbox();
  leave(ib, '1-a', 'Run the tests');
  const sent = [];
  const at = { deliverSync: (sid, text, opts) => { sent.push([sid, text, opts]); return { id: 'm1' }; } };
  const out = hook.start({ session_id: SID, cwd: ib.project, source: 'startup' }, { root: ib.root, noTouch: true, aiThreads: at });
  assert.strictEqual(out, null);
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0][0], SID);
  assert.strictEqual(sent[0][1], 'Run the tests');
  assert.strictEqual(sent[0][2].thread, false);
  assert.strictEqual(sent[0][2].retouch, true);
  assert.strictEqual(fs.readFileSync(path.join(ib.starts, 'p-1-a.sid'), 'utf8'), SID);
  assert.ok(fs.existsSync(path.join(ib.starts, `${SID}.claimed`)));
  assert.strictEqual(fs.readFileSync(path.join(ib.starts, `${SID}.json`), 'utf8'), '{}');
  assert.strictEqual(hook.wake({ session_id: SID, file_path: path.join(ib.starts, `${SID}.json`) }), null); // nothing left to wake with
});

test('a handoff that fails falls back to the relay\'s own delivery', () => {
  const ib = inbox();
  leave(ib, '1-a', 'Still delivered');
  const at = { deliverSync: () => { throw new Error('disk full'); } };
  const out = hook.start({ session_id: SID, cwd: ib.project, source: 'startup' }, { root: ib.root, noTouch: true, aiThreads: at });
  const file = path.join(ib.starts, `${SID}.json`);
  assert.deepStrictEqual(out.hookSpecificOutput.watchPaths, [file]);
  assert.ok(!fs.existsSync(path.join(ib.starts, `${SID}.claimed`)));
  assert.strictEqual(hook.wake({ session_id: SID, file_path: file }), 'Still delivered');
});

test('ai-threads is used only when the window named its home and its hooks are installed', () => {
  const root = tmp(), home = tmp();
  const runtime = path.join(home, 'runtime');
  fs.mkdirSync(runtime, { recursive: true });
  const fake = (installed) => fs.writeFileSync(path.join(runtime, 'index.js'),
    `module.exports = { open: (o) => ({ home: o.home }), claudeCode: { install: { status: () => ({ installed: ${installed} }) } } };`);
  fake(true);
  assert.strictEqual(hook.aiThreads(root), null); // no ai-threads.json
  relay.writeAtomic(path.join(root, hook.HANDOFF), { home });
  const fresh = (p) => { delete require.cache[require.resolve(p)]; return require(p); };
  assert.deepStrictEqual(hook.aiThreads(root, { load: fresh }), { home });
  fake(false);
  assert.strictEqual(hook.aiThreads(root, { load: fresh }), null); // hooks not installed for this account
  relay.writeAtomic(path.join(root, hook.HANDOFF), { home: path.join(home, 'missing') });
  assert.strictEqual(hook.aiThreads(root, { load: fresh }), null); // nothing loads there
});

test('as Claude Code runs it: start prints the watch, wake exits 2 with the prompt on stderr', () => {
  const ib = inbox();
  leave(ib, '1-a', 'Fix the build');
  const s = runHook(['start'], { session_id: SID, cwd: ib.project, source: 'startup' }, ib.root);
  assert.strictEqual(s.status, 0, s.stderr);
  const file = JSON.parse(s.stdout).hookSpecificOutput.watchPaths[0];
  const w = runHook(['wake', '#claude-session-relay'], { session_id: SID, file_path: file }, ib.root);
  assert.strictEqual(w.status, 2);
  assert.strictEqual(w.stderr.trim(), 'Fix the build');
  const none = runHook(['start'], { session_id: SID2, cwd: ib.project, source: 'startup' }, ib.root);
  assert.deepStrictEqual([none.status, none.stdout], [0, ''], 'nothing to claim: silent');
  const bad = spawnSync(process.execPath, [HOOK, 'wake'], { input: 'not json', env: { ...process.env, RELAY_INBOX: ib.root }, encoding: 'utf8' });
  assert.strictEqual(bad.status, 0, 'a broken input never breaks the conversation');
});

test('startConversation returns the session the hook reported, and withdraws an unclaimed prompt', async () => {
  const ib = inbox();
  const r = await relay.startConversation(ib.ws, '1-a', 'Go', async () => {
    hook.start({ session_id: SID, cwd: ib.project, source: 'startup' }, { root: ib.root, noTouch: true });
  }, { pollMs: 20 });
  assert.deepStrictEqual(r, { started: true, session: SID });
  assert.deepStrictEqual(fs.readdirSync(ib.starts), [`${SID}.json`], 'the prompt waits for the wake, nothing else is left');
  await assert.rejects(relay.startConversation(ib.ws, '2-b', 'Nobody', async () => {}, { waitMs: 100, pollMs: 20 }), /did not pick up the prompt/);
  assert.ok(!fs.existsSync(path.join(ib.starts, 'p-2-b.json')));
});

test('install adds the two hooks after the user\'s own, once, with a backup; remove takes only ours', () => {
  const claudeDir = tmp(), root = tmp();
  const mine = { model: 'opus', hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'python mine.py' }] }] } };
  fs.writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify(mine));
  const r1 = installer.install({ inbox: root, claudeDir });
  assert.ok(r1.changed && fs.existsSync(r1.backup));
  assert.ok(fs.existsSync(path.join(root, 'hook.js')), 'the hook is copied next to the inbox');
  const s = JSON.parse(fs.readFileSync(r1.settings, 'utf8'));
  assert.strictEqual(s.model, 'opus');
  assert.strictEqual(s.hooks.SessionStart.length, 2);
  assert.strictEqual(s.hooks.SessionStart[0].hooks[0].command, 'python mine.py');
  assert.match(s.hooks.SessionStart[1].hooks[0].command, /hook\.js" start #claude-session-relay$/);
  assert.strictEqual(s.hooks.FileChanged[0].hooks[0].asyncRewake, true);
  assert.strictEqual(installer.install({ inbox: root, claudeDir }).changed, false, 'twice is once');
  assert.strictEqual(installer.status({ claudeDir }).installed, true);
  installer.uninstall({ claudeDir });
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(r1.settings, 'utf8')), mine);
  assert.strictEqual(installer.status({ claudeDir }).installed, false);
});

test('a settings file that is not JSON is left untouched', () => {
  const claudeDir = tmp();
  fs.writeFileSync(path.join(claudeDir, 'settings.json'), '{ broken');
  assert.throws(() => installer.install({ inbox: tmp(), claudeDir }), /not valid JSON, left untouched/);
  assert.strictEqual(fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf8'), '{ broken');
});

test('relay hook install | status | remove from the command line', () => {
  const claudeDir = tmp(), root = tmp();
  const env = { ...process.env, CLAUDE_CONFIG_DIR: claudeDir };
  const cli = (...a) => JSON.parse(execFileSync(process.execPath, [BIN, 'hook', ...a, '--inbox', root], { env, encoding: 'utf8' }));
  assert.strictEqual(cli('install').installed, true);
  assert.strictEqual(cli('status').installed, true);
  assert.strictEqual(cli('remove').installed, false);
  assert.strictEqual(cli('status').installed, false);
});
