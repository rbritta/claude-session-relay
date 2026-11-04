'use strict';
/*
 * The `relay` command line against a fake window, with plain Node:
 * node test/cli.test.js
 *
 * The "window" is relay.serveOnce on a timer, the same loop the extension runs,
 * with a perform that records instead of touching VS Code.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const relay = require('../src/relay');

const BIN = path.join(__dirname, '..', 'bin', 'relay.js');
const SID = '3007172c-30ed-48a3-a551-fc7a288b219d';
const INBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-cli-'));

const run = (...args) => new Promise((resolve) => {
  execFile(process.execPath, [BIN, ...args, '--inbox', INBOX], (err, stdout, stderr) => {
    let out = null;
    try { out = JSON.parse(stdout); } catch (_) { /* usage or error text */ }
    resolve({ code: err ? err.code : 0, out, stderr });
  });
});

/* a window named `name`, answering every 50 ms until stopped */
function window(name, perform = async () => {}) {
  const dir = path.join(INBOX, name);
  relay.ensurePrivateDir(dir);
  const seen = [];
  const beat = () => relay.writeAtomic(path.join(dir, '.window.json'), { workspace: name, folders: [dir], tabs: [], at: new Date().toISOString() });
  beat();
  let busy = false;
  const t = setInterval(async () => {
    if (busy) return;
    busy = true;
    await relay.serveOnce(dir, async (r) => { seen.push(r); await perform(r); }, { tabs: () => [{ label: 'Tab', active: true }], onReply: beat });
    busy = false;
  }, 50);
  return { dir, seen, stop: () => clearInterval(t) };
}

let failed = 0;
const queue = [];
const test = (name, fn) => queue.push([name, fn]);

test('new: the request reaches the window and the reply comes back', async () => {
  const w = window('api');
  const r = await run('new', 'api', '--prompt', 'Run the tests');
  w.stop();
  assert.strictEqual(r.code, 0, r.stderr);
  assert.strictEqual(r.out.ok, true);
  assert.deepStrictEqual(r.out.tabs, [{ label: 'Tab', active: true }]);
  assert.deepStrictEqual(w.seen, [{ action: 'new', session: null, prompt: 'Run the tests', name: null, start: false }]);
  assert.deepStrictEqual(fs.readdirSync(w.dir), ['.window.json'], 'the client deletes the reply it read');
});

test('rename and open pass the session; a failure exits 1 with the error', async () => {
  const w = window('web', async (r) => { if (r.action === 'rename') throw new Error('window in use, try again later'); });
  const a = await run('open', 'web', SID);
  const b = await run('rename', 'web', SID, 'Fix', 'login');
  w.stop();
  assert.strictEqual(a.code, 0);
  assert.strictEqual(w.seen[0].session, SID);
  assert.strictEqual(w.seen[1].name, 'Fix login');
  assert.strictEqual(b.code, 1);
  assert.strictEqual(b.out.error, 'window in use, try again later');
});

test('no window answering: times out, takes its request back, exits 1', async () => {
  relay.ensurePrivateDir(path.join(INBOX, 'gone'));
  const r = await run('tabs', 'gone', '--timeout', '1');
  assert.strictEqual(r.code, 1);
  assert.match(r.out.error, /no window answered as "gone"/);
  assert.deepStrictEqual(fs.readdirSync(path.join(INBOX, 'gone')), [], 'a window opened later must not act on it');
});

test('--no-wait leaves the request queued', async () => {
  relay.ensurePrivateDir(path.join(INBOX, 'later'));
  const r = await run('tabs', 'later', '--no-wait');
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.out.queued, true);
  assert.deepStrictEqual(fs.readdirSync(path.join(INBOX, 'later')), [`${r.out.id}.json`]);
});

test('bad input is refused before anything is written', async () => {
  const unknown = await run('tabs', 'never-seen');
  assert.strictEqual(unknown.code, 2);
  assert.match(unknown.stderr, /no window has ever listened as "never-seen"/);
  const badSid = await run('close', 'later', 'not-a-uuid');
  assert.strictEqual(badSid.code, 2);
  assert.match(badSid.stderr, /UUID/);
  assert.strictEqual(fs.readdirSync(path.join(INBOX, 'later')).length, 1, 'only the --no-wait request');
  const usage = await run('nope', 'x');
  assert.strictEqual(usage.code, 2);
  assert.match(usage.stderr, /^usage:/);
});

test('list tells live windows from stale heartbeats', async () => {
  const dead = path.join(INBOX, 'dead');
  relay.ensurePrivateDir(dead);
  relay.writeAtomic(path.join(dead, '.window.json'), { workspace: 'dead', at: new Date(Date.now() - 60e3).toISOString() });
  const w = window('alive');
  const r = await run('list');
  w.stop();
  const by = Object.fromEntries(r.out.map((x) => [x.workspace, x.alive]));
  assert.strictEqual(by.alive, true);
  assert.strictEqual(by.dead, false);
});

(async () => {
  for (const [name, fn] of queue) {
    try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.stack}`); }
  }
  fs.rmSync(INBOX, { recursive: true, force: true });
  console.log(failed ? `\n${failed} failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
