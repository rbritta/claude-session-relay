#!/usr/bin/env node
'use strict';
/*
 * The command line side of Claude Session Relay: drop a request in a window's
 * inbox and wait for its reply. No dependencies.
 *
 *   relay list
 *   relay new   <workspace> [--prompt "text"] [--start]
 *   relay open  <workspace> <session> [--prompt "text"]
 *   relay close <workspace> <session>
 *   relay rename <workspace> <session> <name>
 *   relay tabs  <workspace>
 *   relay close-window <workspace>
 *   relay hook install | remove | status
 *
 * --start sends the prompt instead of typing it in: the conversation starts
 * working on its own. It needs the auto-start hook (`relay hook install`, or the
 * command "Claude Session Relay: Install auto-start hook" in VS Code).
 *
 * Options: --inbox <dir> (default: the extension's default), --timeout <seconds> (default 15, 45 with --start),
 * --no-wait (drop the request and exit). Prints the reply as JSON; exits 1 when it failed.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const relay = require('../src/relay');
const installer = require('../src/install');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const flag = (k) => { const i = args.indexOf(k); if (i < 0) return false; args.splice(i, 1); return true; };

const inbox = relay.expand(opt('--inbox', '')) || relay.defaultInbox();
const prompt = opt('--prompt', null);
const start = flag('--start');
const timeout = Number(opt('--timeout', start ? 45 : 15)) * 1000;
const noWait = flag('--no-wait');
const [cmd, workspace, ...rest] = args;

const fail = (m) => { console.error(m); process.exit(2); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function list() {
  if (!fs.existsSync(inbox)) return [];
  return fs.readdirSync(inbox).map((w) => {
    try {
      const b = JSON.parse(fs.readFileSync(path.join(inbox, w, '.window.json'), 'utf8'));
      return { ...b, alive: Date.now() - Date.parse(b.at) < 20000 };
    } catch (_) { return null; }
  }).filter(Boolean);
}

async function send(body) {
  const dir = path.join(inbox, workspace);
  if (!fs.existsSync(dir)) fail(`no window has ever listened as "${workspace}" in ${inbox}`);
  relay.parseRequest(body);
  const id = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  relay.writeAtomic(path.join(dir, `${id}.json`), body);
  if (noWait) return { id, queued: true };
  const reply = path.join(dir, `${id}${relay.REPLY}`);
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    await sleep(250);
    if (fs.existsSync(reply)) {
      const r = JSON.parse(fs.readFileSync(reply, 'utf8'));
      fs.unlinkSync(reply);
      return { id, ...r };
    }
  }
  try { fs.unlinkSync(path.join(dir, `${id}.json`)); } catch (_) { /* taken at the last moment */ }
  return { id, ok: false, error: `no window answered as "${workspace}" in ${timeout / 1000}s (is it open?)` };
}

(async () => {
  if (cmd && !['list', 'hook'].includes(cmd) && !workspace) fail('which workspace? see `relay list`');
  let out;
  switch (cmd) {
    case 'list': out = list(); break;
    case 'new': out = await send({ action: 'new', prompt, ...(start ? { start: true } : {}) }); break;
    case 'open': out = await send({ action: 'open', session: rest[0], prompt }); break;
    case 'close': out = await send({ action: 'close', session: rest[0] }); break;
    case 'rename': out = await send({ action: 'rename', session: rest[0], name: rest.slice(1).join(' ') }); break;
    case 'tabs': out = await send({ action: 'tabs' }); break;
    case 'close-window': out = await send({ action: 'closeWindow' }); break;
    case 'hook':
      // here `workspace` is the subcommand
      if (workspace === 'install') out = installer.install({ inbox });
      else if (workspace === 'remove') out = installer.uninstall();
      else if (workspace === 'status') out = installer.status();
      else fail('usage: relay hook install | remove | status');
      break;
    default: fail('usage: relay list | new|tabs|close-window <workspace> | open|close <workspace> <session> | rename <workspace> <session> <name> | hook install|remove|status  [--prompt text] [--start] [--inbox dir] [--timeout s] [--no-wait]');
  }
  console.log(JSON.stringify(out, null, 2));
  process.exit(out && out.ok === false ? 1 : 0);
})().catch((e) => fail(e.message));
