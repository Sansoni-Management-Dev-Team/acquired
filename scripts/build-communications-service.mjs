// Build only. Never loads env files, listens, contacts providers or changes a database.
import {createRequire} from 'node:module';
import {mkdirSync,chmodSync} from 'node:fs';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url),vite=require.resolve('vite',{paths:[require.resolve('vitest/package.json')]}),{build}=await import(require.resolve('esbuild',{paths:[vite]}));
const directory=join(root,'.local-data/communications/service-build');mkdirSync(directory,{recursive:true,mode:0o700});
const outfile=join(directory,'service.cjs');
// Next handles this build-time boundary marker itself. This separate Node-only
// entry has no client build; consume the marker without modifying app imports.
const serverMarker={name:'native-server-only-marker',setup(builder){
 builder.onResolve({filter:/^server-only$/},()=>({path:'server-only',namespace:'native-server-marker'}));
 builder.onLoad({filter:/^server-only$/,namespace:'native-server-marker'},()=>({contents:'',loader:'js'}));
}};
await build({entryPoints:[join(root,'scripts/communications-service-entry.ts')],bundle:true,platform:'node',target:'node22',format:'cjs',packages:'external',plugins:[serverMarker],tsconfig:join(root,'tsconfig.json'),outfile});
chmodSync(outfile,0o600);console.log('Communications service built. Starting it requires explicit private configuration and approved storage.');
