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
for (const file of [...manifest.background.scripts, ...manifest.content_scripts.flatMap(item => item.js), manifest.action.default_popup]) {
  assert(fs.existsSync(path.join(root, file)), `Missing manifest resource: ${file}`);
}
console.log('Manifest, packaged resources, version alignment, and JavaScript syntax passed.');
