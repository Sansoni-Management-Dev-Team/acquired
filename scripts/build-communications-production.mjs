// Build source only. Never loads runtime env files, starts listeners or connects to storage.
import {createRequire} from 'node:module';
import {chmodSync} from 'node:fs';
import {resolve,join} from 'node:path';
await import('./build-communications-service.mjs');
const root=resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url),vite=require.resolve('vite',{paths:[require.resolve('vitest/package.json')]}),{build}=await import(require.resolve('esbuild',{paths:[vite]}));
const outfile=join(root,'.local-data/communications/service-build/configuration-preflight.cjs');
const marker={name:'native-server-only-marker',setup(b){b.onResolve({filter:/^server-only$/},()=>({path:'server-only',namespace:'native-server-marker'}));b.onLoad({filter:/^server-only$/,namespace:'native-server-marker'},()=>({contents:'',loader:'js'}));}};
await build({entryPoints:[join(root,'ops/communications/production/service/configuration-preflight.ts')],bundle:true,platform:'node',target:'node22',format:'cjs',packages:'external',plugins:[marker],tsconfig:join(root,'tsconfig.json'),outfile});
chmodSync(outfile,0o600);

const {packageCommunicationsRuntime}=await import('./package-communications-runtime.mjs');
await packageCommunicationsRuntime();
