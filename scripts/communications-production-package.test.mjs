import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync,copyFileSync,cpSync,existsSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=new URL('../',import.meta.url),directory=new URL('ops/communications/production/service/',root);
const read=name=>readFileSync(new URL(name,directory),'utf8');
test('service image uses a locked dependency install, non-root runtime and only compiled entrypoint',()=>{
 const dockerfile=read('Dockerfile');
 assert.match(dockerfile,/pnpm@11\.8\.0/);assert.match(dockerfile,/install --frozen-lockfile/);assert.doesNotMatch(dockerfile,/install --prod/);
 assert.match(dockerfile,/USER node/);assert.match(dockerfile,/node:22\.23\.1-bookworm-slim/g);assert.match(dockerfile,/service-runtime/);
 assert.doesNotMatch(dockerfile,/COPY \. \.|migrat|drizzle|dotenv|env_file/);
 assert.match(read('Dockerfile.dockerignore'),/^\*\*/);assert.doesNotMatch(read('Dockerfile.dockerignore'),/!\.env|!\.local-data|!ops\/communications\/standalone/);
});
test('production compose resolves to a loopback-only, restricted service with no database provisioning',()=>{
 const path=mkdtempSync(join(tmpdir(),'communications-production-compose-'));
 try{
  copyFileSync(new URL('compose.production.yml',directory),join(path,'compose.yml'));writeFileSync(join(path,'.env.production'),'');
  const result=spawnSync('docker',['compose','-f',join(path,'compose.yml'),'config','--format','json'],{encoding:'utf8',env:{PATH:process.env.PATH,HOME:process.env.HOME,COMMUNICATIONS_IMAGE:'acquire-communications:synthetic-review'}});
  assert.equal(result.status,0,result.stderr);const cfg=JSON.parse(result.stdout);assert.deepEqual(Object.keys(cfg.services),['communications']);const s=cfg.services.communications;
  assert.equal(s.ports.length,1);assert.equal(s.ports[0].host_ip,'127.0.0.1');assert.equal(s.ports[0].published,'18099');assert.equal(s.ports[0].target,5461);assert.equal(s.read_only,true);assert.equal(s.environment.NODE_ENV,'production');assert.equal(s.environment.COMMUNICATIONS_LISTEN_HOST,'0.0.0.0');assert.equal(s.user,undefined);assert.deepEqual(s.cap_drop,['ALL']);assert.equal(s.volumes,undefined);assert.equal(cfg.volumes,undefined);assert.deepEqual(s.healthcheck.test,['CMD','node','healthcheck.mjs']);
 }finally{rmSync(path,{recursive:true,force:true});}
});
test('healthcheck verifies the actual contract and fails closed on HTTP or payload errors',async()=>{
 const {checkServiceHealth}=await import(new URL('healthcheck.mjs',directory));
 await checkServiceHealth(async url=>{assert.equal(url,'http://127.0.0.1:5461/health');return new Response(JSON.stringify({contractVersion:'1'}));});
 for(const response of [new Response('{}'),new Response(JSON.stringify({contractVersion:'2'})),new Response('unavailable',{status:503})])await assert.rejects(()=>checkServiceHealth(async()=>response));
 await assert.rejects(()=>checkServiceHealth(async()=>{throw Error('network');}));
});
test('compiled production preflight validates synthetic runtime configuration without database or provider access',()=>{
 const built=spawnSync(process.execPath,['scripts/build-communications-production.mjs'],{cwd:root,encoding:'utf8',env:{PATH:process.env.PATH}});assert.equal(built.status,0,built.stderr);
 const key=n=>Buffer.alloc(32,n).toString('base64');
 const env={PATH:process.env.PATH,NODE_ENV:'production',COMMUNICATIONS_RUNTIME_ENABLED:'true',DATABASE_URL:'postgresql://synthetic:synthetic@127.0.0.1:1/app',COMMUNICATIONS_DATABASE_URL:'postgresql://synthetic:synthetic@127.0.0.1:1/service',COMMUNICATIONS_SERVICE_URL:'https://communications.example.invalid',UNIPILE_API_URL:'https://api.example.invalid:20255',UNIPILE_API_KEY:'synthetic-provider-key-never-used',COMMUNICATIONS_APPLICATION_ID:'acquire',COMMUNICATIONS_INTEGRATION_ID:'production-test',COMMUNICATIONS_PROVIDER_CONFIGURATION_REFERENCE:'production-test-v1',COMMUNICATIONS_KEYRING_JSON:JSON.stringify([{version:'v1',encryptionKey:key(11),digestKey:key(12)}]),COMMUNICATIONS_ACTIVE_KEY_VERSION:'v1',COMMUNICATIONS_IDENTITY_KEY:key(13),COMMUNICATIONS_IDENTITY_KEY_VERSION:'v1',COMMUNICATIONS_SETUP_CALLBACK_KEY:key(14),COMMUNICATIONS_SCOPED_AUTH_KEY:key(15),COMMUNICATIONS_WEBHOOK_SECRET:'synthetic-webhook-secret-never-used',ACQUIRE_COMMUNICATIONS_ACTIVE_KEY_VERSION:'a1',ACQUIRE_COMMUNICATIONS_KEYRING_JSON:JSON.stringify([{version:'a1',encryptionKey:key(21),digestKey:key(22)}]),COMMUNICATIONS_REDIRECT_ORIGIN:'https://app.example.invalid',COMMUNICATIONS_SETUP_NOTIFY_URL:'https://communications.example.invalid/v1/setup/notify'};
 const run=override=>spawnSync(process.execPath,['.local-data/communications/service-build/configuration-preflight.cjs'],{cwd:root,encoding:'utf8',env:{...env,...override},timeout:5000});
 const valid=run({});assert.equal(valid.status,0,valid.stderr);assert.match(valid.stdout,/database readiness is separate/);
 const isolated=realpathSync(mkdtempSync(join(tmpdir(),'communications-runtime-isolated-')));
 try{
  cpSync(new URL('.local-data/communications/service-runtime/',root),isolated,{recursive:true,verbatimSymlinks:true});
  const manifest=JSON.parse(readFileSync(join(isolated,'runtime-manifest.json'),'utf8'));
  const packages=new Map(manifest.packages.map(pkg=>[pkg.name,pkg.version]));
  for(const name of ['@vercel/functions','pg','zod'])assert.ok(packages.has(name),`Missing actual service dependency ${name}`);
  for(const name of ['next','react','react-dom','better-auth','@ag-ui/client','@langfuse/tracing'])assert.equal(packages.has(name),false,`Unrelated application dependency ${name}`);
  assert.equal(packages.get('zod'),JSON.parse(readFileSync(new URL('node_modules/zod/package.json',root),'utf8')).version);
  assert.equal(existsSync(join(isolated,'package.json')),false,'Do not copy root application manifest');
  for(const dependency of manifest.dependencies)assert.ok(realpathSync(join(isolated,dependency)).startsWith(isolated+'/'),'Dependency symlink escaped isolated runtime');
  const hermetic=spawnSync(process.execPath,['runtime.mjs','--check-config'],{cwd:isolated,encoding:'utf8',env,timeout:5000});
  assert.equal(hermetic.status,0,hermetic.stderr);assert.match(hermetic.stdout,/database readiness is separate/);
 }finally{rmSync(isolated,{recursive:true,force:true});}

 for(const override of [{COMMUNICATIONS_RUNTIME_ENABLED:'false'},{COMMUNICATIONS_SERVICE_URL:'http://127.0.0.1:5461'},{COMMUNICATIONS_DATABASE_URL:env.DATABASE_URL},{COMMUNICATIONS_IDENTITY_KEY:env.COMMUNICATIONS_SCOPED_AUTH_KEY},{UNIPILE_API_KEY:''}]){const result=run(override);assert.notEqual(result.status,0);assert.equal(result.stdout,'');assert.doesNotMatch(result.stderr,/synthetic-provider|synthetic:synthetic|AQEBA/);assert.match(result.stderr,/configuration unavailable/);}
});
test('service startup decodes hosted CA strictly before importing the service',async()=>{
 const {prepareServiceEnvironment}=await import(new URL('runtime.mjs',directory));
 const ca='-----BEGIN CERTIFICATE-----\nsynthetic\n-----END CERTIFICATE-----';
 assert.equal(prepareServiceEnvironment({DATABASE_SSL_CA_BASE64:Buffer.from(ca).toString('base64')}).DATABASE_SSL_CA,ca);
 assert.deepEqual(prepareServiceEnvironment({DATABASE_SSL_CA:ca}),{DATABASE_SSL_CA:ca});
 for(const input of [{DATABASE_SSL_CA_BASE64:'invalid!'},{DATABASE_SSL_CA_BASE64:Buffer.from('private bytes').toString('base64')},{DATABASE_SSL_CA:ca,DATABASE_SSL_CA_BASE64:Buffer.from(ca).toString('base64')}])assert.throws(()=>prepareServiceEnvironment(input),/Hosted database CA unavailable/);
});
test('communications runtime excludes unneeded application dependencies through traced packaging',()=>{
 const dockerfile=read('Dockerfile');
 assert.doesNotMatch(dockerfile,/COPY --from=dependencies[^\n]*node_modules/,'The service must not ship every root application dependency');
 assert.match(dockerfile,/service-runtime/);
});

test('runtime trace tolerates only named optional imports at their actual dependency boundary',async()=>{
 const {checkRuntimeTraceWarnings}=await import('./package-communications-runtime.mjs');
 const optional=new Error('Failed to resolve dependency "pg-native":\nCannot find module \'pg-native\' loaded from /build/node_modules/.pnpm/pg@8.23.0/node_modules/pg/lib/native/client.js');
 assert.doesNotThrow(()=>checkRuntimeTraceWarnings([optional]));
 assert.throws(()=>checkRuntimeTraceWarnings([new Error('Failed to resolve dependency "zod":\nCannot find module \'zod\' loaded from /build/service.cjs')]),/Unexpected communications runtime trace warning/);
 assert.throws(()=>checkRuntimeTraceWarnings([new Error('Failed to resolve dependency "pg-native":\nCannot find module \'pg-native\' loaded from /build/service.cjs')]),/Unexpected communications runtime trace warning/);
});
