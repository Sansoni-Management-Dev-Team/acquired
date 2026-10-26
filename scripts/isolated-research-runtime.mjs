// Stage an explicit, bundled local Worker release. Never starts/stops a container.
import {cpSync,mkdirSync,readFileSync,writeFileSync,readdirSync,statSync,rmSync,mkdtempSync,symlinkSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve,join,relative} from 'node:path';
import {pathToFileURL} from 'node:url';

export function sourceSnapshot(root,destination){
 mkdirSync(destination,{recursive:true,mode:0o700});
 // Allowlist: no .env, credentials, .local-data, runtime state or node_modules.
 for(const name of ['src','cloudflare/research','communications/packages/core/src','package.json','pnpm-lock.yaml','tsconfig.json'])cpSync(join(root,name),join(destination,name),{recursive:true});
}
export function localRuntimeConfig(config){
 if(config.vars?.LOCAL_DEVELOPMENT!=='true'||!/^http:\/\/127\.0\.0\.1:\d+$/.test(config.vars?.APP_ORIGIN||''))throw Error('An existing isolated local Worker config is required');
 // Preserve the existing workflow/DO identities so /state remains usable.
 const {name,compatibility_date,compatibility_flags,workflows,durable_objects,exports,vars}=config;
 return {name,main:'/release/bundle/index.js',compatibility_date,compatibility_flags,workflows,durable_objects,exports,vars};
}
export function runtimeOverlay({release,modulesVolume}){
 if(!release.startsWith('/')||!modulesVolume||!/^[-a-zA-Z0-9_]+$/.test(modulesVolume))throw Error('Absolute release path and existing dependency volume required');
 return {services:{research:{image:'node:22.12.0',network_mode:'service:network',working_dir:'/runtime',labels:{'au.mlai.acquire.research.release':release.split('/').at(-1)},command:['node','/workspace/node_modules/wrangler/bin/wrangler.js','dev','--local','--no-bundle','--config','/config/wrangler.json','--ip','127.0.0.1','--port','8787','--inspector-port','0','--persist-to','/state','--show-interactive-dev-session=false'],environment:{CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV:'false',CLOUDFLARE_INCLUDE_PROCESS_ENV:'false',WRANGLER_SEND_METRICS:'false',MINIFLARE_CACHE_DIR:'/runtime/miniflare'},volumes:[`${release}:/workspace:ro`,`${release}:/release:ro`,`${modulesVolume}:/workspace/node_modules:ro`,`${release}/wrangler.json:/config/wrangler.json:ro`,'isolated-research-scratch:/runtime','isolated-research-state:/state'],restart:'unless-stopped'}},volumes:{'isolated-research-scratch':{}}};
}
function fingerprint(directory){
 const hash=createHash('sha256');
 function visit(path){for(const file of readdirSync(path).sort()){const full=join(path,file);if(statSync(full).isDirectory())visit(full);else{hash.update(relative(directory,full));hash.update('\0');hash.update(readFileSync(full));}}}
 visit(directory);return hash.digest('hex');
}
export function stageRuntime({root,configFile,directory,modulesVolume}){
 const config=localRuntimeConfig(JSON.parse(readFileSync(configFile,'utf8')));
 mkdirSync(directory,{recursive:true,mode:0o700});
 const temporary=mkdtempSync(join(directory,'.stage-'));
 try{
  sourceSnapshot(root,join(temporary,'source'));
  const sourceHash=fingerprint(join(temporary,'source'));
  const buildConfig={...config,main:join(temporary,'source/cloudflare/research/index.ts')};
  writeFileSync(join(temporary,'build.json'),JSON.stringify(buildConfig));
  symlinkSync(join(root,'node_modules'),join(temporary,'source/node_modules'));
  // Wrangler's normal production bundler, with upload explicitly disabled.
  execFileSync(process.execPath,[join(root,'node_modules/wrangler/bin/wrangler.js'),'deploy','--dry-run','--config',join(temporary,'build.json'),'--outdir',join(temporary,'bundle')],{cwd:temporary,env:{PATH:process.env.PATH,HOME:process.env.HOME,WRANGLER_SEND_METRICS:'false',CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV:'false',CLOUDFLARE_INCLUDE_PROCESS_ENV:'false'},stdio:['ignore','pipe','pipe'],timeout:120000});
  const bundleHash=fingerprint(join(temporary,'bundle'));
  const release=join(directory,`${sourceHash.slice(0,12)}-${bundleHash.slice(0,12)}-${Date.now()}`);
  mkdirSync(release,{mode:0o700});cpSync(join(temporary,'bundle'),join(release,'bundle'),{recursive:true});
  // Docker cannot create a nested mount point inside the read-only release.
  // Create it before the immutable release is mounted; dependencies stay external.
  mkdirSync(join(release,'node_modules'));
  writeFileSync(join(release,'wrangler.json'),JSON.stringify(config,null,2),{mode:0o600});
  writeFileSync(join(release,'compose.runtime.json'),JSON.stringify(runtimeOverlay({release,modulesVolume}),null,2),{mode:0o600});
  const manifest={schema:1,createdAt:new Date().toISOString(),sourceHash,bundleHash,gitRevision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),modulesVolume,workflowNames:config.workflows?.map(item=>item.name),release,activation:'Append compose.runtime.json to the EXISTING isolated base and research overlays; up -d --no-deps research only. This interrupts that worker. Never use down, -v, or recreate network. No automatic replay.'};
  writeFileSync(join(release,'manifest.json'),JSON.stringify(manifest,null,2),{mode:0o600});
  return manifest;
 }finally{rmSync(temporary,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const args=process.argv.slice(2),value=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
 const options={root:resolve(import.meta.dirname,'..'),configFile:value('--config'),directory:value('--directory'),modulesVolume:value('--modules-volume')};
 if(!options.configFile||!options.directory||!options.modulesVolume)throw Error('Usage: node scripts/isolated-research-runtime.mjs --config <existing-local-wrangler.json> --directory <private-releases> --modules-volume <existing-volume> [--stage]');
 const config=localRuntimeConfig(JSON.parse(readFileSync(options.configFile,'utf8')));
 if(args.includes('--stage'))console.log(JSON.stringify(stageRuntime(options),null,2));
 else console.log(JSON.stringify({mode:'plan',source:options.root,directory:resolve(options.directory),modulesVolume:options.modulesVolume,workflowNames:config.workflows?.map(item=>item.name),actions:['Snapshot allowed source files and bundle with Wrangler --dry-run','Write a versioned release, hash manifest and research-only Compose overlay','Do not activate, restart, migrate, modify database or replay jobs']},null,2));
}
