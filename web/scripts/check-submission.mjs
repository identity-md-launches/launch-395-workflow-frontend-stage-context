import { execFileSync } from 'node:child_process';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'../..');
const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
const split=text=>text?text.split('\n'):[];
const modified=split(git(['diff','HEAD','--name-only']));
const added=split(git(['ls-files','--others','--exclude-standard'])).filter(p=>!p.startsWith('test/scratch/'));
const delivery=[...new Set([...modified,...added])].filter(p=>p!=='docs/evidence/submission-check.json').sort();
const allowed=p=>p.startsWith('web/')||p.startsWith('dist/')||p.startsWith('docs/');
assert(delivery.every(allowed),'Out-of-scope changed path');
assert(delivery.every(p=>!p.split('/').some(part=>['node_modules','.cache','.npm','.pnpm-store','.vite'].includes(part))),'Dependency/cache artifact');
assert(delivery.every(p=>!p.endsWith('.tgz')),'Unnecessary npm archive');
assert(delivery.filter(p=>p.split('/').at(-1).startsWith('.')).every(p=>p==='web/.gitignore'),'Unbudgeted dotfile');
assert(!git(['ls-files','--stage']).split('\n').some(line=>line.startsWith('160000 ')),'Submodule');
const changed=await Promise.all(delivery.map(async path=>({path,bytes:(await stat(resolve(root,path))).size})));
const tracked=split(git(['ls-files']));
const complete=[...new Set([...tracked,...delivery])];
let completeTreeBytes=0;
for(const path of complete)completeTreeBytes+=(await stat(resolve(root,path))).size;
const history=execFileSync('git',['bundle','create','test/scratch/existing-history.bundle','--all'],{cwd:root,encoding:'utf8'});
const historyBytes=(await stat(resolve(root,'test/scratch/existing-history.bundle'))).size;
const candidateBytes=changed.reduce((sum,f)=>sum+f.bytes,0);
// Conservative delivery accounting: existing packed history, raw new files, and 64 KiB metadata allowance.
// An exact bundle containing the frontend cannot be emitted without a writable Git repository.
const accountedBytes=historyBytes+candidateBytes+65536;
assert(accountedBytes<8388608,'Submission accounting exceeds 8 MiB');
const report={result:'pass',scope:'working-tree additions; existing source unchanged',ignoredDependencyProbe:git(['check-ignore','web/node_modules/react/package.json']),
  changedFiles:changed,deliveryBytesExcludingThisReport:candidateBytes,completeTreeBytesExcludingThisReport:completeTreeBytes,existingHistoryBundleBytes:historyBytes,
  conservativeBundleAccountingBytesExcludingThisReport:accountedBytes,maximumBundleBytes:8388608,
  actualFrontendCommitBundle:'unavailable: .git is read-only; Git staging failed with EROFS',ignoreFileBudget:['web/.gitignore'],submodules:0};
await writeFile(resolve(root,'docs/evidence/submission-check.json'),JSON.stringify(report,null,2)+'\n');
const reportSize=(await stat(resolve(root,'docs/evidence/submission-check.json'))).size;
assert(accountedBytes+reportSize<8388608);
console.log(JSON.stringify({files:changed.length,deliveryBytes:candidateBytes+reportSize,completeTreeBytes:completeTreeBytes+reportSize,
  conservativeBundleAccountingBytes:accountedBytes+reportSize,limit:8388608,result:'pass'},null,2));
