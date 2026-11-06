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

// Identity and data-use declarations that must stay valid for signing and for installs.
const gecko = manifest.browser_specific_settings?.gecko ?? {};
assert(/^[a-zA-Z0-9-._]*@[a-zA-Z0-9-._]+$/.test(gecko.id ?? '') && gecko.id.length <= 80, 'gecko.id must be a valid, stable extension ID');
assert(!/invalid|prototype|local/i.test(gecko.id), 'gecko.id must not be a placeholder; it keys users’ local data and cannot change after the first signed release');
assert(parseInt(gecko.strict_min_version, 10) >= 140, 'gecko.strict_min_version must be 140 or later for built-in data-consent prompts');
const required = gecko.data_collection_permissions?.required ?? [];
assert(required.length > 0 && !required.includes('none'), 'Headlines are sent to Genios; declare the data in gecko.data_collection_permissions.required');
assert(gecko.update_url === undefined || String(gecko.update_url).startsWith('https://'), 'gecko.update_url must use https');

for (const file of fs.readdirSync(root).filter(file => file.endsWith('.js'))) {
  new vm.Script(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file });
}
const referenced = new Set([
  'manifest.json',
  ...manifest.background.scripts,
  ...manifest.content_scripts.flatMap(item => item.js),
  manifest.action.default_popup,
  ...Object.values(manifest.icons ?? {}),
  ...[manifest.action.default_icon ?? []].flat().flatMap(icon => typeof icon === 'string' ? [icon] : Object.values(icon)),
]);
for (const file of referenced) {
  assert(fs.existsSync(path.join(root, file)), `Missing manifest resource: ${file}`);
}
// Local files that extension pages load (scripts, stylesheets); remote links are ignored.
for (const page of fs.readdirSync(root).filter(file => file.endsWith('.html'))) {
  referenced.add(page);
  for (const [, target] of fs.readFileSync(path.join(root, page), 'utf8').matchAll(/\b(?:src|href)="([^"]+)"/g)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) continue;
    assert(fs.existsSync(path.join(root, target)), `Missing resource referenced by ${page}: ${target}`);
    referenced.add(target);
  }
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
console.log('Manifest, extension ID and data declarations, packaged resources, packaging allowlist, version alignment, and JavaScript syntax passed.');
