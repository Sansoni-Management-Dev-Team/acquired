// Fresh compiled reply integration, isolated from existing fixture containers and provider credentials.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),directory=join(root,'.local-data/communications/verification');
const build=join(root,'.local-data/communications/reply-orbstack-build');
mkdirSync(directory,{recursive:true,mode:0o700});
assert.equal(execFileSync('git',['check-ignore','.local-data/communications/reply-orbstack-build'],{cwd:root,encoding:'utf8'}).trim(),'.local-data/communications/reply-orbstack-build');
execFileSync(process.execPath,[join(root,'node_modules/typescript/bin/tsc'),'-p','communications/tsconfig.build.json','--outDir',build],{cwd:root,stdio:'inherit'});
const container=`acquire-communications-replies-${randomUUID().slice(0,8)}`;
const image=JSON.parse(execFileSync('docker',['--context','orbstack','image','inspect','node:22-alpine'],{encoding:'utf8'}))[0];
const output=execFileSync('docker',['--context','orbstack','run','--rm','--interactive','--name',container,'--label','acquire.fixture=communications-replies',
  '--network','none','--read-only','--user','1000:1000','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','64','--memory','128m',
  '--mount',`type=bind,src=${build},dst=/fixture,readonly`,'node:22-alpine','node','--input-type=module'],
  {cwd:root,input:readFileSync(join(root,'scripts/communications-reply-fixture-proof.mjs'),'utf8'),encoding:'utf8',maxBuffer:1024*1024});
const proof=JSON.parse(output),hashes={};
function inventory(directory){for(const e of readdirSync(directory,{withFileTypes:true})){if(['dist','node_modules'].includes(e.name))continue;const p=join(directory,e.name);if(e.isDirectory())inventory(p);else if(e.name.endsWith('.ts') && !e.name.endsWith('.test.ts'))hashes[p.slice(root.length)]=createHash('sha256').update(readFileSync(p)).digest('hex');}}
inventory(join(root,'communications'));
const report={checkedAt:new Date().toISOString(),sourceRevision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sourceHashes:hashes,
  verificationScriptHashes:Object.fromEntries(['scripts/test-communications-replies-orbstack.mjs','scripts/communications-reply-fixture-proof.mjs'].map(p=>[p,createHash('sha256').update(readFileSync(join(root,p))).digest('hex')])),
  image:image.Id,dockerContext:'orbstack',network:'none',compiledMountReadonly:true,envOrCredentialMounts:false,proof};
writeFileSync(join(directory,'reply-orbstack.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
console.log('All-channel reply HTTP/normalization/processing fixture passed in isolated OrbStack. Memory ports only; no migrations, live credentials, network egress or persistent-storage claim.');
