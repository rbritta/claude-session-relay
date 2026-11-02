'use strict';
/* The pure protocol, with plain Node: node test/relay.test.js */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const relay = require('../src/relay');

let failed = 0;
const test = (name, fn) => {
  try { fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.stack}`); }
};
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

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
