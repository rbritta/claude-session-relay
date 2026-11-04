'use strict';
/* The pure protocol, with plain Node: node test/relay.test.js */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const relay = require('../src/relay');

let failed = 0;
const queue = [];
const test = (name, fn) => queue.push([name, fn]);
const SID = '3007172c-30ed-48a3-a551-fc7a288b219d';

test('a window is named by the first matching rule, with $1', () => {
  const rules = [{ pattern: '^[a-z]:[\\\\/]dev[\\\\/](env\\d+)', name: '$1' }];
  assert.strictEqual(relay.workspaceName(['D:\\dev\\env3\\src'], rules), 'env3');
  assert.strictEqual(relay.workspaceName(['E:\\Projects\\Notes'], rules), 'notes');
  assert.strictEqual(relay.workspaceName(['E:\\Projects\\Notes'], rules, true), null);
});

test('the fallback name is the base name, lower-cased and safe', () => {
  assert.strictEqual(relay.workspaceName(['/home/me/My Project/']), 'my-project');
  assert.strictEqual(relay.workspaceName([]), null);
});

test('a bad rule is skipped, not fatal', () => {
  assert.strictEqual(relay.workspaceName(['C:\\x\\api'], [{ pattern: '(', name: 'bad' }]), 'api');
});

test('the account filter reads CLAUDE_CONFIG_DIR', () => {
  assert.ok(relay.accountMatches('', ''));
  assert.ok(relay.accountMatches('[\\\\/]\\.claude-work$', 'C:\\Users\\me\\.claude-work'));
  assert.ok(!relay.accountMatches('[\\\\/]\\.claude-work$', 'C:\\Users\\me\\.claude'));
});

test('requests are validated', () => {
  assert.deepStrictEqual(relay.parseRequest({ action: 'new', prompt: 'hi' }), { action: 'new', session: null, prompt: 'hi', name: null });
  assert.strictEqual(relay.parseRequest({ action: 'open' }).action, 'new');
  assert.strictEqual(relay.parseRequest({ action: 'open', session: SID }).action, 'open');
  assert.throws(() => relay.parseRequest({ action: 'close' }), /needs a session/);
  assert.throws(() => relay.parseRequest({ action: 'open', session: 'nope' }), /UUID/);
  assert.throws(() => relay.parseRequest({ action: 'rename', session: SID, name: ' ' }), /needs a name/);
  assert.throws(() => relay.parseRequest({ action: 'rm -rf' }), /unknown action/);
});

test('paths expand ~ and %VAR%', () => {
  assert.strictEqual(relay.expand('%FOO%\\x', { FOO: 'C:\\a' }), 'C:\\a\\x');
  assert.strictEqual(relay.expand('${env:FOO}/x', { FOO: '/a' }), '/a/x');
  assert.ok(relay.expand('~/x').startsWith(os.homedir()));
});

test('the inbox: pending, claim once, replies are not requests', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-'));
  relay.writeAtomic(path.join(dir, '2.json'), { action: 'tabs' });
  relay.writeAtomic(path.join(dir, '1.json'), { action: 'new' });
  relay.writeAtomic(path.join(dir, '0.done.json'), { ok: true });
  fs.writeFileSync(path.join(dir, '3.json'), '{"action":'); // half written
  assert.deepStrictEqual(relay.pending(dir), ['1.json', '2.json', '3.json']);
  assert.deepStrictEqual(relay.claim(path.join(dir, '1.json')), { action: 'new' });
  assert.strictEqual(relay.claim(path.join(dir, '1.json')), null);
  assert.strictEqual(relay.claim(path.join(dir, '3.json')), null);
  assert.ok(fs.existsSync(path.join(dir, '3.json')), 'a half-written request stays for the next round');
  fs.rmSync(dir, { recursive: true, force: true });
});

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'relay-'));
const age = (file, ms) => { const t = (Date.now() - ms) / 1000; fs.utimesSync(file, t, t); };

test('serveOnce runs requests in id order and replies to each', async () => {
  const dir = tmp();
  relay.writeAtomic(path.join(dir, '2.json'), { action: 'tabs' });
  relay.writeAtomic(path.join(dir, '1.json'), { action: 'new', prompt: 'hi' });
  const done = [];
  let replies = 0;
  const next = await relay.serveOnce(dir, async (r) => { done.push(r.action); }, { tabs: () => [{ label: 'x', active: true }], onReply: () => replies++ });
  assert.strictEqual(next, null);
  assert.deepStrictEqual(done, ['new', 'tabs']);
  assert.strictEqual(replies, 2);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, '1.done.json'), 'utf8')), { ok: true, error: null, tabs: [{ label: 'x', active: true }] });
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['1.done.json', '2.done.json']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a bad or failing request gets an error reply and does not stop the round', async () => {
  const dir = tmp();
  relay.writeAtomic(path.join(dir, '1.json'), { action: 'rm -rf' });
  relay.writeAtomic(path.join(dir, '2.json'), { action: 'close', session: SID });
  relay.writeAtomic(path.join(dir, '3.json'), { action: 'tabs' });
  const done = [];
  await relay.serveOnce(dir, async (r) => { if (r.action === 'close') throw new Error('no such tab'); done.push(r.action); });
  const reply = (id) => JSON.parse(fs.readFileSync(path.join(dir, `${id}.done.json`), 'utf8'));
  assert.match(reply(1).error, /unknown action/);
  assert.strictEqual(reply(1).ok, false);
  assert.strictEqual(reply(2).error, 'no such tab');
  assert.strictEqual(reply(3).ok, true);
  assert.deepStrictEqual(done, ['tabs']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('closeWindow replies first, then stops: the rest waits for another window', async () => {
  const dir = tmp();
  relay.writeAtomic(path.join(dir, '1.json'), { action: 'closeWindow' });
  relay.writeAtomic(path.join(dir, '2.json'), { action: 'tabs' });
  const next = await relay.serveOnce(dir, async () => {});
  assert.strictEqual(next, 'closeWindow');
  assert.ok(fs.existsSync(path.join(dir, '1.done.json')));
  assert.ok(fs.existsSync(path.join(dir, '2.json')), 'not taken');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a request nobody took for 5 minutes is answered "expired", not run', async () => {
  const dir = tmp();
  relay.writeAtomic(path.join(dir, '1.json'), { action: 'new', prompt: 'old news' });
  age(path.join(dir, '1.json'), relay.STALE_REQUEST_MS + 60e3);
  const done = [];
  await relay.serveOnce(dir, async (r) => done.push(r));
  assert.deepStrictEqual(done, []);
  assert.match(JSON.parse(fs.readFileSync(path.join(dir, '1.done.json'), 'utf8')).error, /^expired/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('two windows with the same name do a request once', async () => {
  const dir = tmp();
  for (let i = 0; i < 20; i++) relay.writeAtomic(path.join(dir, `${String(i).padStart(2, '0')}.json`), { action: 'tabs' });
  let runs = 0;
  const slow = async () => { runs++; await new Promise((r) => setTimeout(r, 2)); };
  await Promise.all([relay.serveOnce(dir, slow), relay.serveOnce(dir, slow)]);
  assert.strictEqual(runs, 20);
  assert.strictEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.done.json')).length, 20);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('sweep removes old unread replies and temp files, nothing else', () => {
  const dir = tmp();
  for (const f of ['old.done.json', 'old.json.123.tmp', 'new.done.json', 'old.json', '.window.json']) fs.writeFileSync(path.join(dir, f), '{}');
  for (const f of ['old.done.json', 'old.json.123.tmp', 'old.json', '.window.json']) age(path.join(dir, f), relay.STALE_REPLY_MS + 60e3);
  assert.deepStrictEqual(relay.sweep(dir).sort(), ['old.done.json', 'old.json.123.tmp']);
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['.window.json', 'new.done.json', 'old.json']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('inbox folders and files are private to their owner (Linux, macOS)', () => {
  if (process.platform === 'win32') return;
  const root = tmp();
  fs.chmodSync(root, 0o755);
  const ws = path.join(root, 'ws');
  fs.mkdirSync(ws);
  fs.chmodSync(ws, 0o777);
  relay.ensurePrivateDir(root, { narrow: false });
  relay.ensurePrivateDir(ws);
  assert.strictEqual(fs.statSync(root).mode & 0o777, 0o755, 'a folder the user chose is not narrowed');
  assert.strictEqual(fs.statSync(ws).mode & 0o777, 0o700);
  relay.ensurePrivateDir(path.join(root, 'a', 'b'), { narrow: false });
  assert.strictEqual(fs.statSync(path.join(root, 'a')).mode & 0o077, 0, 'a folder it creates is private');
  relay.writeAtomic(path.join(ws, 'x.json'), {});
  assert.strictEqual(fs.statSync(path.join(ws, 'x.json')).mode & 0o077, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

(async () => {
  for (const [name, fn] of queue) {
    try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.stack}`); }
  }
  console.log(failed ? `\n${failed} failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
