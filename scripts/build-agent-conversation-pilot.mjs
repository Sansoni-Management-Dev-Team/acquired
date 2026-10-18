// Build only. No environment, credentials, database or provider is read.
import {createRequire} from 'node:module';
import {mkdirSync,chmodSync,renameSync} from 'node:fs';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url),vite=require.resolve('vite',{paths:[require.resolve('vitest/package.json')]}),{build}=await import(require.resolve('esbuild',{paths:[vite]}));
const directory=join(root,'.local-data/agent-mode-orbstack');mkdirSync(directory,{recursive:true,mode:0o700});
const outfile=join(directory,'conversation-pilot.cjs'),serverMarker={name:'pilot-server-marker',setup(builder){builder.onResolve({filter:/^server-only$/},()=>({path:'server-only',namespace:'pilot-marker'}));builder.onLoad({filter:/.*/,namespace:'pilot-marker'},()=>({contents:'',loader:'js'}));}};
await build({entryPoints:[join(root,'scripts/agent-conversation-pilot.ts')],bundle:true,platform:'node',target:'node22',format:'cjs',packages:'external',plugins:[serverMarker],tsconfig:join(root,'tsconfig.json'),outfile:outfile+'.next'});
chmodSync(outfile+'.next',0o600);renameSync(outfile+'.next',outfile);console.log('Local scoped-conversation operator harness built; no execution started.');
