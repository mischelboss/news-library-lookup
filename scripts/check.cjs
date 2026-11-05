const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../extension');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const pkg = require('../package.json');
assert.equal(manifest.version, pkg.version, 'Package and extension versions must match');
assert.equal(manifest.manifest_version, 3);
assert.deepEqual(manifest.host_permissions, ['https://bib-voebb.genios.de/*']);
assert(manifest.content_security_policy.extension_pages.includes("connect-src 'self' https://bib-voebb.genios.de"));
for (const file of fs.readdirSync(root).filter(file => file.endsWith('.js'))) {
  new vm.Script(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file });
}
const referenced = new Set([
  'manifest.json',
  ...manifest.background.scripts,
  ...manifest.content_scripts.flatMap(item => item.js),
  manifest.action.default_popup,
]);
for (const file of referenced) {
  assert(fs.existsSync(path.join(root, file)), `Missing manifest resource: ${file}`);
}
// Local files the popup page loads (scripts, stylesheets); remote links are ignored.
const popup = fs.readFileSync(path.join(root, manifest.action.default_popup), 'utf8');
for (const [, target] of popup.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) continue;
  assert(fs.existsSync(path.join(root, target)), `Missing popup resource: ${target}`);
  referenced.add(target);
}

// The packaged ZIP uses an explicit allowlist; keep it in step with the extension directory.
const allowlist = JSON.parse(fs.readFileSync(path.join(__dirname, 'package-files.json'), 'utf8'));
assert.equal(new Set(allowlist).size, allowlist.length, 'scripts/package-files.json has duplicate entries');
for (const file of allowlist) {
  assert(fs.existsSync(path.join(root, file)), `Packaged file does not exist: ${file}`);
}
for (const file of referenced) {
  assert(allowlist.includes(file), `Referenced by the extension but missing from scripts/package-files.json: ${file}`);
}
const present = fs.readdirSync(root, { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile() && !entry.name.startsWith('.'))
  .map(entry => path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'));
for (const file of present) {
  assert(allowlist.includes(file), `Extension file is not in scripts/package-files.json (add it or remove it): ${file}`);
}
console.log('Manifest, packaged resources, packaging allowlist, version alignment, and JavaScript syntax passed.');
