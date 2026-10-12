// Verify the foundation package in a fresh dependency-installed copy, outside Acquire's modules.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const privateDirectory = join(root, '.local-data/communications');
mkdirSync(privateDirectory, { recursive: true, mode: 0o700 });
const copy = mkdtempSync(join(privateDirectory, 'independent-copy-'));
assert.equal(execFileSync('git', ['check-ignore', copy], { cwd: root, encoding: 'utf8' }).trim(), copy);
const excluded = new Set(['node_modules', 'dist', 'coverage', '.git']);
cpSync(join(root, 'communications'), copy, {
  recursive: true,
  filter: source => !excluded.has(basename(source)) && !basename(source).startsWith('.env'),
});
const hashes = {};
function inventory(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) inventory(path);
    else hashes[path.slice(copy.length + 1)] = createHash('sha256').update(readFileSync(path)).digest('hex');
  }
}
inventory(copy);
const docker = args => execFileSync('docker', ['--context', 'orbstack', ...args], { cwd: root, encoding: 'utf8' });
const metadata = JSON.parse(docker(['inspect', 'acquire-communications-fixture']))[0];
assert.equal(metadata.Config.Labels?.['acquire.fixture'], 'communications');
const name = `acquire-communications-copy-${randomUUID().slice(0, 8)}`;
// Node 22's bundled npm 10.9.9 crashes in Arborist's optional-peer graph for this dependency set.
// Bootstrap a pinned compatible CLI independently; preserve the declared package dependencies.
const packageManagerVersion = '11.6.2';
const packageManagerIntegrity = '7iKzNfy8lWYs3zq4oFPa8EXZz5xt9gQNKJZau3B1ErLBb6bF7sBJ00x09485DOvRT2l5Gerbl3VlZNT57MxJVA==';
const verify = String.raw`
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {mkdirSync,writeFileSync,readdirSync,readFileSync}=require('node:fs');
const {createHash}=require('node:crypto');
async function main(){
assert.equal(process.env.UNIPILE_API_KEY,undefined);
assert.equal(process.env.DATABASE_URL,undefined);
const response=await fetch('https://registry.npmjs.org/npm/-/npm-${packageManagerVersion}.tgz',{redirect:'error',signal:AbortSignal.timeout(30000)});
assert.equal(response.status,200);
const archive=Buffer.from(await response.arrayBuffer());
assert.equal(createHash('sha512').update(archive).digest('base64'),'${packageManagerIntegrity}');
mkdirSync('/tmp/package-manager');writeFileSync('/tmp/package-manager/npm.tgz',archive);
const unpack=spawnSync('tar',['-xzf','/tmp/package-manager/npm.tgz','-C','/tmp/package-manager'],{stdio:'inherit'});
assert.equal(unpack.status,0);
const cli='/tmp/package-manager/package/bin/npm-cli.js';
assert.equal(require('/tmp/package-manager/package/package.json').version,'${packageManagerVersion}');
for(const args of [['install','--ignore-scripts','--no-audit','--no-fund'],['run','build'],['test','--','--maxWorkers=2']]) {
  const result=spawnSync(process.execPath,[cli,...args],{cwd:'/verify',stdio:'inherit',timeout:300000});
  if(result.status!==0){
    for(const file of readdirSync('/tmp/npm-cache/_logs')) process.stderr.write(readFileSync('/tmp/npm-cache/_logs/'+file,'utf8').slice(-8000));
    process.exit(result.status||1);
  }
}
const api=require('/verify/dist/src/index.js');
for(const name of ['UnipileV1Transport','createUnipileV1MessagingAdapter','createDispatchCoordinator','JournalCodec','CommunicationsClient','createCommunicationsServer','normalizeV1ReplyEvent','createReplyWebhookIngress','createReplyProcessor','createReplyWebhookServer']) assert.equal(typeof api[name],'function');
assert.equal(process.env.UNIPILE_API_KEY,undefined);
assert.equal(process.env.DATABASE_URL,undefined);
process.stdout.write('Independent package build/tests/exports passed without Acquire modules or provider credentials.\n');
}
main().catch(error=>{process.stderr.write(error.stack+'\n');process.exit(1)});
`;
execFileSync('docker', ['--context', 'orbstack', 'run', '--rm', '--interactive', '--name', name,
  '--label', 'acquire.fixture=communications-copy', '--read-only', '--user', `${process.getuid()}:${process.getgid()}`,
  '--mount', `type=bind,src=${copy},dst=/verify`, '--tmpfs', '/tmp:rw,mode=1777', '--workdir', '/verify',
  '--env', 'npm_config_cache=/tmp/npm-cache', '--env', 'npm_config_userconfig=/tmp/no-npmrc',
  '--env', 'npm_config_ignore_scripts=true', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
  '--pids-limit', '128', '--memory', '512m', metadata.Image, 'node'], {
  cwd: root, input: verify, stdio: ['pipe', 'inherit', 'inherit'],
});
const report = { checkedAt: new Date().toISOString(), scope: 'Fresh isolated foundation copy with independent npm install, build, tests and aggregate exports',
  sourceHashes: hashes, image: metadata.Image, dockerContext: 'orbstack', packageManager: `npm@${packageManagerVersion}`, packageManagerIntegrity: `sha512-${packageManagerIntegrity}`, testMaxWorkers: 2, providerWrites: 0, migrationsApplied: 0,
  resolvedDependencyLockSha256: createHash('sha256').update(readFileSync(join(copy, 'package-lock.json'))).digest('hex'),
  wholeRuntimeExtractionVerified: false, retainedPrivateCopy: copy };
writeFileSync(join(privateDirectory, 'verification/independent-copy.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
console.log('Independent foundation copy verified in OrbStack. Full backend/runtime extraction remains outstanding.');
