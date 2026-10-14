import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
function fixture(options={}){
 const root=mkdtempSync(join(tmpdir(),'communications-rollout-')),host=join(root,'host'),service=join(host,'ops/communications/service'),release=join(root,'release'),bin=join(root,'bin');
 for(const p of[service,release,bin])mkdirSync(p,{recursive:true});const sha='a'.repeat(40),runtime='PRIVATE_RUNTIME=preserved\n';
 if(!options.MISSING_RUNTIME)writeFileSync(join(service,'.env.production'),runtime,{mode:options.PUBLIC_RUNTIME?0o644:0o600});
 if(options.PREPARED_COMPOSE)writeFileSync(join(service,'compose.production.yml'),'prepared-compose\n');
 if(!options.FIRST_RELEASE){writeFileSync(join(service,'.env'),'COMMUNICATIONS_IMAGE=acquire-communications:previous\n');writeFileSync(join(service,'compose.production.yml'),'previous-compose\n');}
 const archive=gzipSync('synthetic image');writeFileSync(join(release,'image-communications.tar.gz'),options.TAMPER_ARCHIVE?gzipSync('corrupt image'):archive);
 for(const[name,value]of Object.entries({commit:sha,'service-archive-sha256':createHash('sha256').update(archive).digest('hex'),'service-compose.production.yml':'new-compose\n','communications-deploy-schema-preflight.mjs':'// synthetic mounted preflight\n'}))writeFileSync(join(release,name),value);
 const script=readFileSync(new URL('./communications-deploy-host.sh',import.meta.url),'utf8').replaceAll('/opt/acquire-app',host);writeFileSync(join(root,'deploy.sh'),script);
 writeFileSync(join(bin,'flock'),'#!/bin/sh\nexit 0\n',{mode:0o755});
 writeFileSync(join(bin,'docker'),`#!/bin/sh
echo "$*" >> "$FIXTURE_LOG"
case "$*" in
 load) cat >/dev/null;;
 'image inspect '*) echo "$FIXTURE_REVISION";;
 'run '*) case "$*" in *--check-config*) if [ "$FAIL_CONFIG" = 1 ]; then exit 1; fi;; *schema-preflight.mjs*) if [ "$FAIL_SCHEMA" = 1 ]; then exit 1; fi;; esac;;
 'compose up '*) if [ "$FAIL_STARTUP" = 1 ] && [ ! -f "$FIXTURE_FAILURE" ]; then touch "$FIXTURE_FAILURE"; exit 1; fi;;
 'compose exec '*) if [ "$FAIL_HEALTH" = 1 ] && [ ! -f "$FIXTURE_FAILURE" ]; then touch "$FIXTURE_FAILURE"; exit 1; fi;;
esac
`,{mode:0o755});
 let result=spawnSync('bash',[join(root,'deploy.sh'),release,sha],{encoding:'utf8',env:{...process.env,PATH:bin+':'+process.env.PATH,FIXTURE_LOG:join(root,'log'),FIXTURE_FAILURE:join(root,'failed'),FIXTURE_REVISION:options.WRONG_REVISION?'b'.repeat(40):sha,...Object.fromEntries(Object.entries(options).map(([k,v])=>[k,v?'1':'']))}});
 if(options.RETRY_AFTER_FAILURE&&result.status!==0){result=spawnSync('bash',[join(root,'deploy.sh'),release,sha],{encoding:'utf8',env:{...process.env,PATH:bin+':'+process.env.PATH,FIXTURE_LOG:join(root,'log'),FIXTURE_REVISION:sha,FIXTURE_FAILURE:join(root,'failed')}});}
 if(options.IDEMPOTENT_THEN_APP_FAILURE&&result.status===0){
  const run=()=>spawnSync('bash',[join(root,'deploy.sh'),release,sha],{encoding:'utf8',env:{...process.env,PATH:bin+':'+process.env.PATH,FIXTURE_LOG:join(root,'log'),FIXTURE_REVISION:sha,FIXTURE_FAILURE:join(root,'failed')}});
  writeFileSync(join(release,'service-deployment-changed'),'true\n');result=run();
  const receipt=existsSync(join(release,'service-deployment-changed'))?readFileSync(join(release,'service-deployment-changed'),'utf8').trim():'true';
  // Exercise the workflow's app-failure decision using this invocation's receipt.
  if(result.status===0&&receipt==='true')result=spawnSync('bash',[join(root,'deploy.sh'),release,sha,'--rollback'],{encoding:'utf8',env:{...process.env,PATH:bin+':'+process.env.PATH,FIXTURE_LOG:join(root,'log'),FIXTURE_REVISION:sha,FIXTURE_FAILURE:join(root,'failed')}});
 }
 if(options.APP_FAILURE_ROLLBACK&&result.status===0){result=spawnSync('bash',[join(root,'deploy.sh'),release,sha,'--rollback'],{encoding:'utf8',env:{...process.env,PATH:bin+':'+process.env.PATH,FIXTURE_LOG:join(root,'log'),FIXTURE_REVISION:sha,FIXTURE_FAILURE:join(root,'failed')}});}
 const read=name=>existsSync(join(service,name))?readFileSync(join(service,name),'utf8'):null;
 const state={result,changed:existsSync(join(release,'service-deployment-changed'))?readFileSync(join(release,'service-deployment-changed'),'utf8').trim():null,image:read('.env'),runtime:read('.env.production'),compose:read('compose.production.yml'),log:existsSync(join(root,'log'))?readFileSync(join(root,'log'),'utf8'):''};rmSync(root,{recursive:true,force:true});return state;
}
test('deploys verified service image without changing production runtime keys or deploying an app',()=>{const s=fixture();assert.equal(s.result.status,0,s.result.stderr);assert.equal(s.image,'COMMUNICATIONS_IMAGE=acquire-communications:github-'+ 'a'.repeat(40)+'\n');assert.equal(s.compose,'new-compose\n');assert.equal(s.runtime,'PRIVATE_RUNTIME=preserved\n');assert.match(s.log,/runtime.mjs --check-config/);assert.match(s.log,/compose exec -T communications node healthcheck.mjs/);assert.doesNotMatch(s.log,/postgres|migration|compose.* app(?: |$)/);});
for(const option of['TAMPER_ARCHIVE','WRONG_REVISION','MISSING_RUNTIME','PUBLIC_RUNTIME','FAIL_CONFIG','FAIL_SCHEMA'])test(option+' fails before replacing service or app',()=>{const s=fixture({[option]:true});assert.notEqual(s.result.status,0);assert.equal(s.image,'COMMUNICATIONS_IMAGE=acquire-communications:previous\n');assert.equal(s.compose,'previous-compose\n');assert.doesNotMatch(s.log,/compose up/);});
for(const option of['FAIL_STARTUP','FAIL_HEALTH'])test(option+' restores previous image and compose while preserving keys',()=>{const s=fixture({[option]:true});assert.notEqual(s.result.status,0);assert.equal(s.image,'COMMUNICATIONS_IMAGE=acquire-communications:previous\n');assert.equal(s.compose,'previous-compose\n');assert.equal(s.runtime,'PRIVATE_RUNTIME=preserved\n');assert.equal(s.log.match(/compose up/g)?.length,2);});
test('failed first release removes only candidate service and restores absent release files',()=>{const s=fixture({FIRST_RELEASE:true,FAIL_STARTUP:true});assert.notEqual(s.result.status,0);assert.equal(s.image,null);assert.equal(s.compose,null);assert.equal(s.runtime,'PRIVATE_RUNTIME=preserved\n');assert.match(s.log,/compose rm --stop --force communications/);assert.doesNotMatch(s.log,/compose down|volume rm|network rm/);});

test('first release can preserve operator prepared compose without a previous image',()=>{const s=fixture({FIRST_RELEASE:true,PREPARED_COMPOSE:true,FAIL_STARTUP:true});assert.notEqual(s.result.status,0);assert.equal(s.image,null);assert.equal(s.compose,'prepared-compose\n');assert.match(s.log,/compose rm --stop --force communications/);});
test('application rollout failure can restore the previously successful service release',()=>{const s=fixture({APP_FAILURE_ROLLBACK:true});assert.equal(s.result.status,0,s.result.stderr);assert.equal(s.image,'COMMUNICATIONS_IMAGE=acquire-communications:previous\n');assert.equal(s.compose,'previous-compose\n');assert.equal(s.runtime,'PRIVATE_RUNTIME=preserved\n');});

test('failed rollout can be retried at the same immutable revision without losing prior rollback state',()=>{const s=fixture({FAIL_STARTUP:true,RETRY_AFTER_FAILURE:true});assert.equal(s.result.status,0,s.result.stderr);assert.equal(s.image,'COMMUNICATIONS_IMAGE=acquire-communications:github-'+ 'a'.repeat(40)+'\n');assert.equal(s.runtime,'PRIVATE_RUNTIME=preserved\n');});

test('same-version retry clears stale changed receipt so later app failure keeps the current service',()=>{const s=fixture({IDEMPOTENT_THEN_APP_FAILURE:true});assert.equal(s.result.status,0,s.result.stderr);assert.equal(s.changed,'false');assert.equal(s.image,'COMMUNICATIONS_IMAGE=acquire-communications:github-'+ 'a'.repeat(40)+'\n');assert.equal(s.compose,'new-compose\n');assert.equal(s.log.match(/compose up/g)?.length,1);});
