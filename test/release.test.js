'use strict';
/*
 * The release notes (tools/release-notes.js) and the version: package.json and
 * CHANGELOG.md agree, with an Unreleased section on top. node --test test/
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { test } = require('node:test');
const { changelogSection, releaseNotes } = require('../tools/release-notes');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'tools', 'release-notes.js');
const { version } = require('../package.json');

const CHANGELOG = `# Changelog

## [Unreleased]

## [1.2.0] - 2026-01-02

### Fixed
- The thing.

## [1.1.0] - 2026-01-01

### Added
- The other thing.

## [1.0.0] - 2025-12-31

[Unreleased]: https://example.com/compare/v1.2.0...HEAD
[1.2.0]: https://example.com/compare/v1.1.0...v1.2.0
`;

test('a section ends at the next heading, the last one at the link references', () => {
  assert.strictEqual(changelogSection(CHANGELOG, '1.2.0'), '### Fixed\n- The thing.');
  assert.strictEqual(changelogSection(CHANGELOG, '1.1.0'), '### Added\n- The other thing.');
  assert.strictEqual(changelogSection(CHANGELOG, '1.0.0'), null, 'an empty section');
});

test('a missing version, or a prefix of one, has no section; CRLF reads the same', () => {
  assert.strictEqual(changelogSection(CHANGELOG, '9.9.9'), null);
  assert.strictEqual(changelogSection(CHANGELOG, '1.2'), null);
  assert.strictEqual(changelogSection(CHANGELOG.replace(/\n/g, '\r\n'), '1.2.0'), '### Fixed\n- The thing.');
});

test('the tag must name the version, and its section must have notes', () => {
  assert.strictEqual(releaseNotes('v1.2.0', { changelog: CHANGELOG, version: '1.2.0' }), '### Fixed\n- The thing.');
  assert.strictEqual(releaseNotes('refs/tags/v1.2.0', { changelog: CHANGELOG, version: '1.2.0' }), '### Fixed\n- The thing.');
  assert.throws(() => releaseNotes('v1.1.0', { changelog: CHANGELOG, version: '1.2.0' }), /does not name the version/);
  assert.throws(() => releaseNotes('', { changelog: CHANGELOG, version: '1.2.0' }), /\(none\)/);
  assert.throws(() => releaseNotes('v1.0.0', { changelog: CHANGELOG, version: '1.0.0' }), /no section, or an empty one/);
});

test('CHANGELOG.md has Unreleased on top, then a dated section for the version in package.json', () => {
  const text = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  const heads = [...text.matchAll(/^## \[([^\]]+)\]/gm)].map((m) => m[1]);
  assert.deepStrictEqual(heads.slice(0, 2), ['Unreleased', version]);
  assert.match(text, new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\] - \\d{4}-\\d\\d-\\d\\d$`, 'm'));
  assert.ok(changelogSection(text, version));
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  assert.deepStrictEqual([lock.version, lock.packages[''].version], [version, version]);
});

test('the script prints the notes of this version and refuses another tag', () => {
  const out = execFileSync(process.execPath, [SCRIPT, `v${version}`], { encoding: 'utf8' });
  assert.ok(out.trim().length > 0);
  const bad = spawnSync(process.execPath, [SCRIPT, 'v0.0.0'], { encoding: 'utf8' });
  assert.strictEqual(bad.status, 1);
  assert.match(bad.stderr, /does not name the version/);
});
