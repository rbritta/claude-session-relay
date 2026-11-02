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
 *   <inbox>/<workspace>/<id>.json         { action, session?, prompt?, name? }   the request
 *   <inbox>/<workspace>/<id>.done.json    { ok, error?, tabs }                   the reply
 *   <inbox>/<workspace>/.window.json      who is listening, refreshed every few seconds
 *
 * See docs/PROTOCOL.md.
 */
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const relay = require('./relay');

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

async function perform(r) {
  switch (r.action) {
    case 'open': return openSession(r.session, r.prompt || undefined);
    // a new conversation, with the prompt typed in its input box (the user presses Enter)
    case 'new': return openSession(undefined, r.prompt || undefined);
    case 'close': { await openSession(r.session); const t = await frontTab(); return vscode.window.tabGroups.close(t); }
    case 'rename': return rename(r.session, r.name);
    case 'tabs': return null;
    case 'closeWindow': return null; // after the reply is written, below
    default: throw new Error(`unknown action: ${r.action}`);
  }
}

exports.activate = (ctx) => {
  const cfg = vscode.workspace.getConfiguration('claudeSessionRelay');
  if (!cfg.get('enabled', true)) return;
  const folders = (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath);
  const name = relay.workspaceName(folders, cfg.get('workspaces', []), cfg.get('onlyMatchingWorkspaces', false));
  if (!name) return;
  const account = cfg.get('claudeConfigDir', '');
  if (!relay.accountMatches(account)) {
    log.appendLine(`${name}: CLAUDE_CONFIG_DIR "${process.env.CLAUDE_CONFIG_DIR || ''}" does not match "${account}", not listening`);
    return;
  }
  const dir = path.join(relay.expand(cfg.get('inbox', '')) || relay.defaultInbox(), name);
  fs.mkdirSync(dir, { recursive: true });
  log.appendLine(`listening as "${name}" on ${dir}`);

  const beat = () => {
    try {
      relay.writeAtomic(path.join(dir, '.window.json'), {
        workspace: name, folders, pid: process.pid, version: VERSION, account: process.env.CLAUDE_CONFIG_DIR || null,
        focused: vscode.window.state.focused, tabs: tabs(), at: new Date().toISOString(),
      });
    } catch (e) { log.appendLine(`heartbeat: ${e.message}`); }
  };

  let busy = false;
  const round = async () => {
    if (busy) return;
    busy = true;
    try {
      for (const f of relay.pending(dir)) {
        const id = f.slice(0, -5);
        const body = relay.claim(path.join(dir, f));
        if (!body) continue;
        let error = null;
        let r = null;
        try {
          r = relay.parseRequest(body);
          await tidy();
          await perform(r);
          await wait(300);
          await tidy();
        } catch (e) { error = e.message; }
        log.appendLine(`${id} ${body.action}${error ? ` failed: ${error}` : ' ok'}`);
        relay.writeAtomic(path.join(dir, `${id}${relay.REPLY}`), { ok: !error, error, tabs: tabs() });
        beat();
        if (!error && r.action === 'closeWindow') { await vscode.commands.executeCommand('workbench.action.closeWindow'); break; }
      }
    } catch (e) { log.appendLine(`round: ${e.message}`); }
    busy = false;
  };

  beat();
  const t1 = setInterval(round, POLL_MS);
  const t2 = setInterval(beat, BEAT_MS);
  ctx.subscriptions.push(log, { dispose: () => { clearInterval(t1); clearInterval(t2); try { fs.unlinkSync(path.join(dir, '.window.json')); } catch (_) { /* gone */ } } });
};

exports.deactivate = () => {};
