import { readFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { abiHash } from '../src/protocol.mjs';
const root = resolve(import.meta.dirname, '../..');
const read = async file => JSON.parse(await readFile(resolve(root, file), 'utf8'));
const m = await read('dist/imd-deployment.json'), handoff = await read('web/config/deployment-handoff.json');
const network = await read('web/config/network.json');
for (const key of ['launchId', 'chainId', 'sourceCommit', 'attestationHash']) assert.deepEqual(m[key], handoff[key]);
assert.equal(m.version, 1); assert.deepEqual(m.network, network.network); assert.deepEqual(m.walletAddChain, network.walletAddChain);
assert.deepEqual(m.contracts.map(({name,address,abiHash}) => ({name,address,abiHash})), handoff.contracts.map(({name,address,abiHash}) => ({name,address,abiHash})));
for (const c of m.contracts) assert.equal(abiHash(await read(`dist/${c.abiPath}`)), c.abiHash);
const paths = []; let total = 0;
async function walk(dir, prefix = '') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = prefix + entry.name; assert(!entry.isSymbolicLink());
    if (entry.isDirectory()) await walk(resolve(dir, entry.name), p + '/');
    else if (p !== 'imd-deployment.json') { paths.push(p); total += (await stat(resolve(dir,entry.name))).size; }
  }
}
await walk(resolve(root, 'dist'));
assert(paths.length <= 128); assert(total < 32 * 1024 * 1024);
assert.deepEqual(paths.sort(), m.assets.map(a => a.path).sort());
for (const a of m.assets) {
  assert(/^[a-zA-Z0-9_./-]+$/.test(a.path) && !a.path.startsWith('/') && !a.path.split('/').includes('..'));
  assert(/^[0-9a-f]{64}$/.test(a.sha256));
  const bytes = await readFile(resolve(root,'dist',a.path)); assert(bytes.length <= 8388608);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), a.sha256);
}
const html = await readFile(resolve(root,'dist/index.html'),'utf8'); assert(!/(?:src|href)="\//.test(html));
const report = { result: 'pass', assets: paths.length, exportBytes: total + (await stat(resolve(root,'dist/imd-deployment.json'))).size,
  contracts: m.contracts.map(c => ({ name:c.name, abiHash:c.abiHash })), sourceCommit: m.sourceCommit };
await import('node:fs/promises').then(fs => fs.writeFile(resolve(root,'docs/evidence/export-check.json'),JSON.stringify(report,null,2)+'\n'));
console.log(JSON.stringify(report,null,2));
