// Copy only the compiled service's traced dependency closure. No runtime activation.
import {copyFileSync,lstatSync,mkdirSync,readFileSync,readlinkSync,realpathSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {dirname,isAbsolute,join,relative,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url);
const optionalImports=new Map([
 ['pg-native','/pg/lib/native/client.js'],
 ['cloudflare:sockets','/pg-cloudflare/dist/index.js'],
 ['bufferutil','/ws/lib/buffer-util.js'],
 ['utf-8-validate','/ws/lib/validation.js'],
]);
export function checkRuntimeTraceWarnings(warnings){
 for(const warning of warnings){
  const message=warning.message||String(warning),match=/^Failed to resolve dependency "([^"]+)":\nCannot find module '[^']+' loaded from (.+)$/.exec(message);
  if(!match||!optionalImports.has(match[1])||!match[2].replaceAll('\\','/').endsWith(optionalImports.get(match[1])))throw Error('Unexpected communications runtime trace warning: '+message);
 }
}
function within(root,path){const rel=relative(root,path);if(isAbsolute(rel)||rel==='..'||rel.startsWith('../'))throw Error('Runtime trace escapes build root');return rel;}
export async function packageCommunicationsRuntime({root=resolve(import.meta.dirname,'..'),output=join(root,'.local-data/communications/service-runtime')}={}){
 root=realpathSync(root);output=resolve(output);
 const entries=['service.cjs','configuration-preflight.cjs'];
 const source=join(root,'.local-data/communications/service-build');
 if(output===root||root.startsWith(output+'/')||output===source||source.startsWith(output+'/')||output===join(root,'node_modules')||output.startsWith(join(root,'node_modules')+'/'))throw Error('Unsafe runtime output directory');
 const {nodeFileTrace}=require('next/dist/compiled/@vercel/nft');
 const trace=await nodeFileTrace(entries.map(name=>join(source,name)),{base:root,processCwd:root});
 checkRuntimeTraceWarnings(trace.warnings);
 rmSync(output,{recursive:true,force:true});mkdirSync(output,{recursive:true});
 const dependencies=[...trace.fileList].filter(path=>path.startsWith('node_modules/')).sort();
 const packages=[];
 for(const path of dependencies){
  const from=join(root,path),to=join(output,path);within(root,from);mkdirSync(dirname(to),{recursive:true});
  if(lstatSync(from).isSymbolicLink()){
   const target=readlinkSync(from);if(isAbsolute(target))throw Error('Absolute dependency symlink cannot be packaged');within(root,resolve(dirname(from),target));symlinkSync(target,to);
  }else{
   copyFileSync(from,to);
   if(path.endsWith('/package.json')){const pkg=JSON.parse(readFileSync(from,'utf8'));if(pkg.name&&pkg.version)packages.push({name:pkg.name,version:pkg.version});}
  }
 }
 // Every copied symlink must resolve within the isolated closure, without access
 // to the original checkout or a global dependency installation.
 for(const path of dependencies)within(output,realpathSync(join(output,path)));
 for(const name of entries)copyFileSync(join(source,name),join(output,name));
 for(const name of ['runtime.mjs','healthcheck.mjs'])copyFileSync(join(root,'ops/communications/production/service',name),join(output,name));
 const manifest={version:1,entries,dependencies,packages:packages.sort((a,b)=>a.name.localeCompare(b.name)),optionalWarnings:[...trace.warnings].map(w=>w.message)};
 writeFileSync(join(output,'runtime-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 return manifest;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const manifest=await packageCommunicationsRuntime();console.log(`Communications runtime packaged with ${manifest.packages.length} traced packages.`);}
