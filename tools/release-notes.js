#!/usr/bin/env node
'use strict';
/*
 * The notes of one release: its section of CHANGELOG.md (Keep a Changelog).
 *
 *   node tools/release-notes.js v1.2.3 > release-notes.md
 *
 * release.yml runs it on a `v*` tag. It exits 1 with the reason when the tag
 * does not name the version in package.json, or when CHANGELOG.md has no
 * section (or an empty one) for that version.
 */
const fs = require('fs');
const path = require('path');

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The body of `## [version]`, trimmed; null when there is none or it is empty. */
function changelogSection(changelog, version) {
  const lines = String(changelog).replace(/\r\n?/g, '\n').split('\n');
  const head = new RegExp(`^## \\[${escape(String(version))}\\](?:\\s|$)`);
  const start = lines.findIndex((line) => head.test(line));
  if (start < 0) return null;
  const next = lines.findIndex((line, i) => i > start && (/^## /.test(line) || /^\[[^\]]+\]:\s/.test(line)));
  return lines.slice(start + 1, next < 0 ? lines.length : next).join('\n').trim() || null;
}

/** The notes for `tag` (`v1.2.3`), which must name `version`. Throws with the reason when it cannot. */
function releaseNotes(tag, { changelog, version }) {
  const named = String(tag || '').replace(/^refs\/tags\//, '').replace(/^v/, '');
  if (named !== version) throw new Error(`the tag ${tag || '(none)'} does not name the version in package.json, ${version}`);
  const notes = changelogSection(changelog, version);
  if (!notes) throw new Error(`CHANGELOG.md has no section, or an empty one, for ${version}`);
  return notes;
}

module.exports = { changelogSection, releaseNotes };

if (require.main === module) {
  const root = path.join(__dirname, '..');
  try {
    const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
    process.stdout.write(`${releaseNotes(process.argv[2], { changelog, version })}\n`);
  } catch (e) {
    console.error(`release-notes: ${e.message}`);
    process.exit(1);
  }
}
