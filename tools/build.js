#!/usr/bin/env node
'use strict';
/*
 * Packs dist/claude-session-relay.vsix with no dependencies (a VSIX is a zip
 * with a manifest), so the build needs only Node. `npx @vscode/vsce package`
 * produces the same thing and is what the Marketplace publish uses.
 *
 *   node tools/build.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const FILES = ['package.json', 'README.md', 'CHANGELOG.md', 'LICENSE', 'docs/icon.png', 'src/extension.js', 'src/relay.js', 'src/hook.js', 'src/install.js', 'bin/relay.js'];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const manifest = `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Language="en-US" Id="${pkg.name}" Version="${pkg.version}" Publisher="${pkg.publisher}"/>
    <DisplayName>${esc(pkg.displayName)}</DisplayName>
    <Description xml:space="preserve">${esc(pkg.description)}</Description>
    <Tags>${esc(pkg.keywords.join(','))}</Tags>
    <Categories>${esc(pkg.categories.join(','))}</Categories>
    <Icon>extension/docs/icon.png</Icon>
    <License>extension/LICENSE</License>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${pkg.engines.vscode}"/>
      <Property Id="Microsoft.VisualStudio.Services.Links.Source" Value="${pkg.repository.url}"/>
    </Properties>
  </Metadata>
  <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation>
  <Dependencies/>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/>
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true"/>
    <Asset Type="Microsoft.VisualStudio.Services.Content.Changelog" Path="extension/CHANGELOG.md" Addressable="true"/>
    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE" Addressable="true"/>
    <Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/docs/icon.png" Addressable="true"/>
  </Assets>
</PackageManifest>`;
const types = '<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  + ['json:application/json', 'js:application/javascript', 'md:text/markdown', 'png:image/png', 'vsixmanifest:text/xml', 'txt:text/plain']
    .map((t) => { const [e, c] = t.split(':'); return `<Default Extension=".${e}" ContentType="${c}"/>`; }).join('')
  + '<Override PartName="/extension/LICENSE" ContentType="text/plain"/></Types>';

// ---- a minimal zip writer (deflate, no zip64) ----
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (b) => { let c = -1; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function zip(entries) {
  const parts = [];
  const central = [];
  let off = 0;
  for (const [name, data] of entries) {
    const n = Buffer.from(name, 'utf8');
    const z = zlib.deflateRawSync(data);
    const crc = crc32(data);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8);
    h.writeUInt32LE(0, 10); h.writeUInt32LE(crc, 14); h.writeUInt32LE(z.length, 18); h.writeUInt32LE(data.length, 22);
    h.writeUInt16LE(n.length, 26); h.writeUInt16LE(0, 28);
    parts.push(h, n, z);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(0, 12); c.writeUInt32LE(crc, 16); c.writeUInt32LE(z.length, 20); c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
    central.push(c, n);
    off += 30 + n.length + z.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}

const entries = [['extension.vsixmanifest', Buffer.from(manifest)], ['[Content_Types].xml', Buffer.from(types)]];
for (const f of FILES) entries.push([`extension/${f}`, fs.readFileSync(path.join(ROOT, f))]);
fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
const out = path.join(ROOT, 'dist', `${pkg.name}.vsix`);
fs.writeFileSync(out, zip(entries));
console.log(`${out} (${pkg.version})`);
