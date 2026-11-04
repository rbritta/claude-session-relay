'use strict';
/*
 * Claude Session Relay - lets a script or a web panel drive the Claude Code
 * tabs of a VS Code window, without focus, `vscode://` links or permission
 * prompts.
 *
 * VS Code has no command line to reach "the Claude tab of that window", so each
 * window watches an inbox folder named after its workspace and acts on the JSON
 * requests dropped there:
 *
 *   <inbox>/<workspace>/<id>.json         { action, session?, prompt?, name?, start? }   the request
 *   <inbox>/<workspace>/<id>.done.json    { ok, error?, started?, session?, tabs }       the reply
 *   <inbox>/<workspace>/.window.json      who is listening, refreshed every few seconds
 *   <inbox>/<workspace>/starts/           prompts waiting for a new conversation (auto-start)
 *
 * See docs/PROTOCOL.md and, for auto-start, src/hook.js.
 */
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const relay = require('./relay');
const installer = require('./install');

const VERSION = require('../package.json').version;
const POLL_MS = 1000;
const BEAT_MS = 5000;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const log = vscode.window.createOutputChannel('Claude Session Relay');

const isClaudeTab = (t) => !!t && t.input instanceof vscode.TabInputWebview && /claude/i.test(t.input.viewType || '');
const tabs = () => vscode.window.tabGroups.all.flatMap((g) => g.tabs.filter(isClaudeTab)
  .map((t) => ({ label: t.label, active: t.isActive && g.isActive })));

/** Brings the session's tab to the front: the open one, or reopens a closed one (same id, like /resume). */
const openSession = (sid, prompt) => vscode.commands.executeCommand('claude-vscode.primaryEditor.open', sid, prompt);

async function frontTab() {
  for (let i = 0; i < 20; i++) {
    await wait(150);
    const t = vscode.window.tabGroups.activeTabGroup.activeTab;
    if (isClaudeTab(t)) return t;
  }
  throw new Error('the session tab did not come to the front');
}

/* A closed tab can leave an empty editor group behind, and the next tab would open next to a blank pane. */
async function tidy() {
  for (const g of vscode.window.tabGroups.all) {
    if (!g.tabs.length && vscode.window.tabGroups.all.length > 1) await vscode.window.tabGroups.close(g);
  }
}

/*
 * Claude Code does not let another extension set a tab title; its own "Rename
 * Session Tab" does (it stores the custom title in the session). Its input box
 * opens with the current name selected, so the new one goes in through the
 * clipboard (restored afterwards) and Enter confirms. Never in the window the
 * user is typing in.
 */
async function rename(sid, name) {
  if (vscode.window.state.focused) throw new Error('window in use, try again later');
  await openSession(sid);
  await frontTab();
  const before = await vscode.env.clipboard.readText();
  try {
    await vscode.env.clipboard.writeText(name);
    const box = vscode.commands.executeCommand('claude-vscode.renameSessionTab');
    await wait(400);
    await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
    await wait(150);
    await vscode.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
    await box;
  } finally { await vscode.env.clipboard.writeText(before); }
  await wait(500);
  const t = vscode.window.tabGroups.activeTabGroup.activeTab;
  const l = t ? t.label : '';
  // Claude Code shortens long titles with an ellipsis
  if (l !== name && !(l.endsWith('…') && name.startsWith(l.slice(0, -1)))) throw new Error(`the tab reads "${l}"`);
}

/*
 * A new conversation that starts on its own: needs the auto-start hook in
 * Claude Code's settings. Without it, the prompt is typed in as before and the
 * reply says so, so the client can tell the user to press Enter.
 */
async function startNew(r, id, dir) {
  if (!installer.status().installed) {
    await openSession(undefined, r.prompt);
    return { started: false, note: 'auto-start hook not installed: the prompt is typed in, press Enter (command "Claude Session Relay: Install auto-start hook")' };
  }
  return relay.startConversation(dir, id, r.prompt, () => openSession(undefined, undefined));
}

async function perform(r, id, dir) {
  switch (r.action) {
    case 'open': return openSession(r.session, r.prompt || undefined);
    // a new conversation: with start, the prompt is sent; without, typed in its input box (the user presses Enter)
    case 'new': return r.start ? startNew(r, id, dir) : openSession(undefined, r.prompt || undefined);
    case 'close': { await openSession(r.session); const t = await frontTab(); return vscode.window.tabGroups.close(t); }
    case 'rename': return rename(r.session, r.name);
    case 'tabs': return null;
    case 'closeWindow': return null; // after the reply is written, below
    default: throw new Error(`unknown action: ${r.action}`);
  }
}

exports.activate = (ctx) => {
  const cfg = vscode.workspace.getConfiguration('claudeSessionRelay');
  ctx.subscriptions.push(log);
  // the hook runs from a copy next to the inbox: keep it current with this version
  const inboxRoot = relay.expand(cfg.get('inbox', '')) || relay.defaultInbox();
  try { if (installer.status().installed) installer.refreshHook(inboxRoot); } catch (e) { log.appendLine(`hook refresh: ${e.message}`); }
  const say = (r) => vscode.window.showInformationMessage(r.changed
    ? `Claude Session Relay: auto-start hook ${r.installed ? 'installed' : 'removed'} in ${r.settings}${r.backup ? ` (backup: ${r.backup})` : ''}. New conversations pick it up.`
    : `Claude Session Relay: the auto-start hook was already ${r.installed ? 'installed' : 'absent'} in ${r.settings}.`);
  const guard = (fn) => () => { try { say(fn()); } catch (e) { vscode.window.showErrorMessage(`Claude Session Relay: ${e.message}`); } };
  ctx.subscriptions.push(
    vscode.commands.registerCommand('claudeSessionRelay.installHook', guard(() => installer.install({ inbox: inboxRoot }))),
    vscode.commands.registerCommand('claudeSessionRelay.uninstallHook', guard(() => installer.uninstall())),
  );

  if (!cfg.get('enabled', true)) return;
  const folders = (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath);
  const name = relay.workspaceName(folders, cfg.get('workspaces', []), cfg.get('onlyMatchingWorkspaces', false));
  if (!name) return;
  const account = cfg.get('claudeConfigDir', '');
  if (!relay.accountMatches(account)) {
    log.appendLine(`${name}: CLAUDE_CONFIG_DIR "${process.env.CLAUDE_CONFIG_DIR || ''}" does not match "${account}", not listening`);
    return;
  }
  const dir = path.join(inboxRoot, name);
  // the root may be a folder the user chose: created private, but not narrowed
  relay.ensurePrivateDir(path.dirname(dir), { narrow: false });
  relay.ensurePrivateDir(dir);
  log.appendLine(`listening as "${name}" on ${dir}`);

  const beat = () => {
    try {
      relay.writeAtomic(path.join(dir, '.window.json'), {
        workspace: name, folders, pid: process.pid, version: VERSION, account: process.env.CLAUDE_CONFIG_DIR || null,
        focused: vscode.window.state.focused, tabs: tabs(), at: new Date().toISOString(),
      });
    } catch (e) { log.appendLine(`heartbeat: ${e.message}`); }
  };

  const act = async (r, id) => {
    await tidy();
    const out = await perform(r, id, dir);
    await wait(300);
    await tidy();
    return out;
  };
  let busy = false;
  const round = async () => {
    if (busy) return;
    busy = true;
    try {
      const next = await relay.serveOnce(dir, act, { tabs, log: (m) => log.appendLine(m), onReply: beat });
      if (next === 'closeWindow') await vscode.commands.executeCommand('workbench.action.closeWindow');
    } catch (e) { log.appendLine(`round: ${e.message}`); }
    busy = false;
  };
  const clean = () => {
    try { for (const f of relay.sweep(dir)) log.appendLine(`removed unread ${f}`); } catch (e) { log.appendLine(`sweep: ${e.message}`); }
  };

  beat();
  clean();
  const t1 = setInterval(round, POLL_MS);
  const t2 = setInterval(() => { beat(); clean(); }, BEAT_MS);
  ctx.subscriptions.push({ dispose: () => { clearInterval(t1); clearInterval(t2); try { fs.unlinkSync(path.join(dir, '.window.json')); } catch (_) { /* gone */ } } });
};

exports.deactivate = () => {};
