'use strict';
/*
 * The extension (src/extension.js) in a fake VS Code: activation, the inbox it
 * listens on, the heartbeat, each action mapped to Claude Code's commands, the
 * settings that keep a window quiet, the ai-threads handoff file and the hook
 * commands. node --test test/
 *
 * `require('vscode')` resolves to a stand-in that records the commands it is
 * asked to run and keeps a list of tabs. Every test gets its own inbox and
 * Claude config folder (CLAUDE_CONFIG_DIR), so nothing real is read or written,
 * and the window it activated is disposed at the end, timers included.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { test, afterEach } = require('node:test');
const relay = require('../src/relay');

const SID = '3007172c-30ed-48a3-a551-fc7a288b219d';
const VERSION = require('../package.json').version;
const FAKE = path.join(__dirname, 'vscode-stand-in.js'); // only a cache key: no such file
const EXTENSION = require.resolve('../src/extension');

const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  return request === 'vscode' ? FAKE : resolve.call(this, request, ...rest);
};

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'csr-ext-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* A stand-in for the parts of the vscode api the extension uses. */
function standIn({ config = {}, folders = [], focused = false } = {}) {
  class TabInputWebview { constructor(viewType) { this.viewType = viewType; } }
  const group = { isActive: true, tabs: [], activeTab: null };
  const seen = { commands: [], closed: [], log: [], info: [], errors: [], registered: {}, onConfig: [] };
  let clipboard = 'what the user had copied';
  const show = (sid) => {
    let tab = group.tabs.find((t) => t.sid === sid && sid);
    if (!tab) {
      tab = { label: sid ? `Session ${sid.slice(0, 4)}` : 'New session', sid, input: new TabInputWebview('claudeVSCodePanel') };
      group.tabs.push(tab);
    }
    group.tabs.forEach((t) => { t.isActive = t === tab; });
    group.activeTab = tab;
  };
  const vscode = {
    TabInputWebview,
    window: {
      createOutputChannel: () => ({ appendLine: (l) => seen.log.push(l), dispose() {} }),
      tabGroups: {
        get all() { return [group]; },
        get activeTabGroup() { return group; },
        close: async (t) => { seen.closed.push(t); group.tabs = group.tabs.filter((x) => x !== t); group.activeTab = group.tabs[0] || null; },
      },
      state: { focused },
      showInformationMessage: (m) => seen.info.push(m),
      showErrorMessage: (m) => seen.errors.push(m),
    },
    commands: {
      executeCommand: async (id, ...args) => {
        seen.commands.push([id, ...args]);
        if (id === 'claude-vscode.primaryEditor.open') show(args[0]);
      },
      registerCommand: (id, fn) => { seen.registered[id] = fn; return { dispose() {} }; },
    },
    workspace: {
      getConfiguration: () => ({ get: (k, d) => (k in config ? config[k] : d) }),
      workspaceFolders: folders.map((f) => ({ uri: { fsPath: f } })),
      onDidChangeConfiguration: (fn) => { seen.onConfig.push(fn); return { dispose() {} }; },
    },
    env: { clipboard: { readText: async () => clipboard, writeText: async (t) => { clipboard = t; } } },
  };
  return { vscode, seen, group, config };
}

const windows = [];

/* Activates a fresh copy of the extension in a stand-in; returns the stand-in, its inbox and the window folder. */
function activate({ config = {}, folders, focused, claudeDir = tmp() } = {}) {
  const inbox = tmp();
  process.env.CLAUDE_CONFIG_DIR = claudeDir;
  const fake = standIn({ config: { inbox, ...config }, folders: folders || [path.join(tmp(), 'My API')], focused });
  require.cache[FAKE] = { id: FAKE, filename: FAKE, loaded: true, exports: fake.vscode };
  delete require.cache[EXTENSION];
  const ext = require(EXTENSION);
  const ctx = { subscriptions: [] };
  ext.activate(ctx);
  windows.push(ctx);
  return { ...fake, ctx, inbox, claudeDir, dir: path.join(inbox, 'my-api') };
}

const dispose = (ctx) => { for (const s of ctx.subscriptions.splice(0)) s.dispose(); };

/* Drops a request in the window's inbox and waits for the reply the extension writes. */
async function request(dir, body, id = `${Date.now()}-t`) {
  relay.writeAtomic(path.join(dir, `${id}.json`), body);
  const done = path.join(dir, `${id}.done.json`);
  for (let i = 0; i < 100 && !fs.existsSync(done); i++) await sleep(50);
  assert.ok(fs.existsSync(done), `no reply to ${JSON.stringify(body)}`);
  return JSON.parse(fs.readFileSync(done, 'utf8'));
}

afterEach(() => {
  for (const ctx of windows.splice(0)) dispose(ctx);
  delete process.env.CLAUDE_CONFIG_DIR;
});

test('a window listens under its folder name, beats a heartbeat and removes it on dispose', () => {
  const w = activate();
  const beat = JSON.parse(fs.readFileSync(path.join(w.dir, '.window.json'), 'utf8'));
  assert.strictEqual(beat.workspace, 'my-api');
  assert.strictEqual(beat.version, VERSION);
  assert.strictEqual(beat.pid, process.pid);
  assert.strictEqual(beat.account, w.claudeDir);
  assert.deepStrictEqual([beat.focused, beat.tabs], [false, []]);
  assert.ok(w.seen.log.some((l) => l.startsWith('listening as "my-api"')));
  dispose(w.ctx);
  assert.ok(!fs.existsSync(path.join(w.dir, '.window.json')));
});

test('new types the prompt into a new conversation and the reply lists the Claude tabs', async () => {
  const w = activate();
  const rep = await request(w.dir, { action: 'new', prompt: 'Run the tests' });
  assert.strictEqual(rep.ok, true, rep.error);
  assert.deepStrictEqual(w.seen.commands[0], ['claude-vscode.primaryEditor.open', undefined, 'Run the tests']);
  assert.deepStrictEqual(rep.tabs, [{ label: 'New session', active: true }]);
});

test('open brings the session back with its prompt; close closes only that tab', async () => {
  const w = activate();
  assert.strictEqual((await request(w.dir, { action: 'new' })).ok, true);
  assert.strictEqual((await request(w.dir, { action: 'open', session: SID, prompt: 'Go on' })).ok, true);
  assert.deepStrictEqual(w.seen.commands.at(-1), ['claude-vscode.primaryEditor.open', SID, 'Go on']);
  const rep = await request(w.dir, { action: 'close', session: SID });
  assert.strictEqual(rep.ok, true, rep.error);
  assert.deepStrictEqual(w.seen.closed.map((t) => t.sid), [SID]);
  assert.deepStrictEqual(rep.tabs, [{ label: 'New session', active: false }]);
});

test('rename refuses while the window has focus, and leaves the clipboard alone', async () => {
  const w = activate({ focused: true });
  const rep = await request(w.dir, { action: 'rename', session: SID, name: 'Item 7 - review' });
  assert.strictEqual(rep.ok, false);
  assert.match(rep.error, /window in use/);
  assert.deepStrictEqual(w.seen.commands, []);
});

test('rename goes through Claude Code\'s own command and puts the clipboard back', async () => {
  const w = activate();
  w.vscode.commands.executeCommand = (orig => async (id, ...args) => {
    await orig(id, ...args);
    if (id === 'workbench.action.acceptSelectedQuickOpenItem') w.group.activeTab.label = await w.vscode.env.clipboard.readText();
  })(w.vscode.commands.executeCommand);
  const rep = await request(w.dir, { action: 'rename', session: SID, name: 'Item 7 - review' });
  assert.strictEqual(rep.ok, true, rep.error);
  assert.ok(w.seen.commands.some(([id]) => id === 'claude-vscode.renameSessionTab'));
  assert.strictEqual(await w.vscode.env.clipboard.readText(), 'what the user had copied');
  assert.deepStrictEqual(rep.tabs, [{ label: 'Item 7 - review', active: true }]);
});

test('closeWindow replies first, then closes the window', async () => {
  const w = activate();
  const rep = await request(w.dir, { action: 'closeWindow' });
  assert.strictEqual(rep.ok, true);
  for (let i = 0; i < 40 && !w.seen.commands.length; i++) await sleep(50);
  assert.deepStrictEqual(w.seen.commands, [['workbench.action.closeWindow']]);
});

test('start without the auto-start hook types the prompt in and says so', async () => {
  const w = activate();
  const rep = await request(w.dir, { action: 'new', prompt: 'Run the tests', start: true });
  assert.strictEqual(rep.ok, true, rep.error);
  assert.strictEqual(rep.started, false);
  assert.match(rep.note, /auto-start hook not installed/);
  assert.deepStrictEqual(w.seen.commands[0], ['claude-vscode.primaryEditor.open', undefined, 'Run the tests']);
});

test('a disabled window, one outside the rules, or one of another account does not listen', () => {
  const off = activate({ config: { enabled: false } });
  assert.ok(!fs.existsSync(off.dir));
  assert.ok(off.seen.registered['claudeSessionRelay.installHook'], 'the hook commands are there anyway');
  const outside = activate({ config: { workspaces: [{ pattern: 'nowhere', name: 'x' }], onlyMatchingWorkspaces: true } });
  assert.deepStrictEqual(fs.readdirSync(outside.inbox), []);
  const other = activate({ config: { claudeConfigDir: '[\\\\/]\\.claude-work$' } });
  assert.ok(!fs.existsSync(other.dir));
  assert.ok(other.seen.log.some((l) => /does not match .* not listening/.test(l)));
});

test('a workspace rule names the window', () => {
  const w = activate({ folders: [path.join(tmp(), 'work', 'ws3')], config: { workspaces: [{ pattern: '[\\\\/]work[\\\\/](ws\\d+)', name: 'team-$1' }] } });
  assert.ok(fs.existsSync(path.join(w.inbox, 'team-ws3', '.window.json')));
});

test('aiThreadsHome writes the handoff file; clearing the setting removes it', () => {
  const home = tmp();
  const w = activate({ config: { aiThreadsHome: home } });
  const file = path.join(w.inbox, 'ai-threads.json');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { home });
  w.config.aiThreadsHome = '';
  w.seen.onConfig.forEach((fn) => fn({ affectsConfiguration: (k) => k === 'claudeSessionRelay.aiThreadsHome' }));
  assert.ok(!fs.existsSync(file));
});

test('the install and remove commands change the account\'s settings and say so', () => {
  const w = activate();
  w.seen.registered['claudeSessionRelay.installHook']();
  assert.match(w.seen.info.at(-1), /auto-start hook installed/);
  const settings = JSON.parse(fs.readFileSync(path.join(w.claudeDir, 'settings.json'), 'utf8'));
  assert.ok(JSON.stringify(settings.hooks).includes('#claude-session-relay'));
  assert.ok(fs.existsSync(path.join(w.inbox, 'hook.js')), 'the hook runs from a copy next to the inbox');
  w.seen.registered['claudeSessionRelay.uninstallHook']();
  assert.match(w.seen.info.at(-1), /auto-start hook removed/);
  w.seen.registered['claudeSessionRelay.uninstallHook']();
  assert.match(w.seen.info.at(-1), /already absent/);
  fs.writeFileSync(path.join(w.claudeDir, 'settings.json'), '{ broken');
  w.seen.registered['claudeSessionRelay.installHook']();
  assert.strictEqual(w.seen.errors.length, 1, 'a settings file that is not JSON is an error message, not a crash');
});
