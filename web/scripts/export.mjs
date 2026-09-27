import { integrationAbis } from '../config/integration-abis.mjs';
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, relative } from 'node:path';
import { abiHash } from '../src/protocol.mjs';
const root = resolve(import.meta.dirname, '../..');
const read = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'));
const handoff = await read('web/config/deployment-handoff.json');
const { network, walletAddChain } = await read('web/config/network.json');
const integrations = await read('web/config/integrations.json');
if (handoff.chainId !== network.chainId || BigInt(walletAddChain.chainId) !== BigInt(handoff.chainId)) throw Error('Network mismatch');
const out = resolve(root, 'dist');
await mkdir(resolve(out, 'abi'), { recursive: true });
const contracts = [];
for (const { name, address, abiHash: expected } of handoff.contracts) {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) throw Error('Invalid contract name');
  const raw = execFileSync('git', ['show', `${handoff.sourceCommit}:docs/abi/${name}.json`], { cwd: root, encoding: 'utf8' });
  const abi = JSON.parse(raw);
  if (!Array.isArray(abi) || abiHash(abi) !== expected) throw Error(`ABI hash mismatch: ${name}`);
  const abiPath = `abi/${name}.json`;
  await writeFile(resolve(out, abiPath), raw);
  contracts.push({ name, address, abiHash: expected, abiPath });
}
for (const [name, abi] of Object.entries(integrationAbis)) await writeFile(resolve(out, `abi/${name}.json`), JSON.stringify(abi, null, 2) + '\n');
const assets = [];
async function walk(dir) {
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = resolve(dir, entry.name);
    if (entry.isSymbolicLink()) throw Error('Export must not contain symlinks');
    if (entry.isDirectory()) { await walk(path); continue; }
    const name = relative(out, path).replaceAll('\\', '/');
    if (name === 'imd-deployment.json') continue;
    if ((await stat(path)).size > 8388608) throw Error(`Asset too large: ${name}`);
    assets.push({ path: name, sha256: createHash('sha256').update(await readFile(path)).digest('hex') });
  }
}
await walk(out);
if (assets.length > 128) throw Error('Too many assets');
const manifest = {
  version: 1, launchId: handoff.launchId, chainId: handoff.chainId,
  sourceCommit: handoff.sourceCommit, attestationHash: handoff.attestationHash,
  contracts, assets, network, walletAddChain, pool: handoff.manifest.pool,
  token: handoff.manifest.token, hook: { contract: handoff.manifest.hook.contract }, integrations,
};
await writeFile(resolve(out, 'imd-deployment.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Export manifest: ${assets.length} assets; ${contracts.length} pinned ABI hashes verified.`);
