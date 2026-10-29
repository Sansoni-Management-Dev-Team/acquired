import {readFileSync,realpathSync} from 'node:fs';
import {resolve,relative,isAbsolute} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function requireValue(ok,message){if(!ok)throw Error(message);}
function file(root,path){requireValue(typeof path==='string'&&path.length>0&&!isAbsolute(path)&&!path.split(/[\\/]/).includes('..'),'Unsafe release path');const base=realpathSync(root),target=realpathSync(resolve(base,path));requireValue(!relative(base,target).startsWith('..'),'Release path escapes root');return readFileSync(target);}
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
/** Offline provenance/compatibility check. Deployment evidence must be collected
 * independently from running artifacts; this function does not contact servers. */
export function verifyCoordinatedRelease(manifest,roots,observed,{preflight=false}={}){
 requireValue(manifest?.version===1,'Unsupported release manifest');
 requireValue(manifest.requires?.contractVersion==='1','Unsupported communications contract');
 for(const name of ['app','simulator']){
  const c=manifest.components?.[name],root=roots[name],d=observed?.[name];
  requireValue(c&&root,`Missing ${name} component/root`);
  requireValue(c.provenanceException===undefined,'Legacy provenance exception cannot pass the clean release gate');
  requireValue(git(root,'status','--porcelain','--untracked-files=all')==='',`${name} requires a clean committed release root`);
  requireValue(/^[a-f0-9]{40,64}$/.test(c.revision??'')&&git(root,'rev-parse','HEAD')===c.revision,`${name} revision mismatch`);
  requireValue(c.inputs&&Object.keys(c.inputs).length>0,`${name} missing source inputs`);
  requireValue(c.buildRecipe&&c.inputs[c.buildRecipe],`${name} missing tracked build recipe`);
  requireValue(c.lockfile&&c.inputs[c.lockfile],`${name} missing tracked lockfile`);
  for(const [path,expected] of Object.entries(c.inputs)){
   requireValue(!path.startsWith('node_modules/'),`${name} dependencies must use dependencyInputs`);
   const bytes=file(root,path);requireValue(digest(expected)&&sha(bytes)===expected,`${name} source hash mismatch: ${path}`);
   const committed=execFileSync('git',['-C',root,'show',`${c.revision}:${path}`],{stdio:['ignore','pipe','pipe']});requireValue(sha(committed)===expected,`${name} committed source hash mismatch: ${path}`);
  }
  for(const [path,expected] of Object.entries(c.dependencyInputs??{})){
   requireValue(path.startsWith('node_modules/'),`${name} invalid dependency path`);
   requireValue(digest(expected)&&sha(file(root,path))===expected,`${name} dependency hash mismatch: ${path}`);
  }
  const artifact=file(roots.artifacts,c.artifact?.path);
  requireValue(digest(c.artifact?.sha256)&&sha(artifact)===c.artifact.sha256,`${name} artifact hash mismatch`);
  const build=JSON.parse(file(roots.artifacts,c.buildManifest));
  requireValue(build.sha256===c.artifact.sha256&&build.artifact===c.artifact.path,`${name} build manifest artifact mismatch`);
  requireValue(Array.isArray(build.sources)&&build.sources.length>0,`${name} missing build manifest inputs`);
  const inputs={...c.inputs,...c.dependencyInputs};const seen=new Set();
  for(const entry of build.sources){requireValue(!seen.has(entry.file)&&digest(entry.sha256)&&inputs[entry.file]===entry.sha256,`${name} build manifest input mismatch`);seen.add(entry.file);}
  requireValue(c.contractVersion===manifest.requires.contractVersion,`${name} contract mismatch`);
  requireValue(typeof c.schemaProfile==='string'&&c.schemaProfile.length>0&&c.schemaProfile===manifest.requires[name+'SchemaProfile'],`${name} schema profile mismatch`);
  requireValue(/^sha256:[a-f0-9]{64}$/.test(c.imageDigest??''),`${name} built image digest missing`);
  if(preflight)continue;
  requireValue(d,`${name} deployment evidence missing`);
  requireValue(d.revision===c.revision&&d.artifactSha256===c.artifact.sha256,`${name} deployment revision/artifact mismatch`);
  requireValue(/^sha256:[a-f0-9]{64}$/.test(c.imageDigest??'')&&d.imageDigest===c.imageDigest,`${name} deployment image digest missing`);
  requireValue(d.contractVersion===c.contractVersion,`${name} deployed contract mismatch`);
  requireValue(d.schemaProfile===c.schemaProfile,`${name} deployed schema profile mismatch`);
 }
 return {verified:true,stage:preflight?'prepared':'deployment-records-checked',scope:'offline provenance and recorded compatibility only',revisions:Object.fromEntries(['app','simulator'].map(name=>[name,manifest.components[name].revision]))};
}
/** Capture a component from the build's recorded inputs, never from guessed files. */
export function captureReleaseComponent(root,artifacts,{buildManifest,buildRecipe,lockfile,schemaProfile,imageDigest,additionalInputs=[]}){
 requireValue(git(root,'status','--porcelain','--untracked-files=all')==='','Capture requires a clean committed release root');
 const build=JSON.parse(file(artifacts,buildManifest));requireValue(Array.isArray(build.sources)&&build.sources.length>0,'Missing build manifest inputs');
 const inputs={},dependencyInputs={};
 for(const entry of build.sources){requireValue(digest(entry.sha256)&&sha(file(root,entry.file))===entry.sha256,'Build input bytes changed');(entry.file.startsWith('node_modules/')?dependencyInputs:inputs)[entry.file]=entry.sha256;}
 for(const path of [buildRecipe,lockfile,...additionalInputs])inputs[path]=sha(file(root,path));
 return {revision:git(root,'rev-parse','HEAD'),buildRecipe,lockfile,inputs,dependencyInputs,artifact:{path:build.artifact,sha256:build.sha256},buildManifest,schemaProfile,contractVersion:'1',imageDigest};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const args=process.argv.slice(2);if(args[0]==='capture'){requireValue(args.length>=8,'Usage: capture ROOT ARTIFACT_ROOT BUILD_MANIFEST BUILD_RECIPE LOCKFILE SCHEMA_PROFILE IMAGE_DIGEST [ADDITIONAL_INPUTS...]');const [,root,artifacts,buildManifest,buildRecipe,lockfile,schemaProfile,imageDigest,...additionalInputs]=args;console.log(JSON.stringify(captureReleaseComponent(root,artifacts,{buildManifest,buildRecipe,lockfile,schemaProfile,imageDigest,additionalInputs}),null,2));}else if(args[0]==='preflight'){requireValue(args.length===5,'Usage: preflight MANIFEST APP_ROOT SIMULATOR_ROOT ARTIFACT_ROOT');const [,manifest,app,simulator,artifacts]=args;console.log(JSON.stringify(verifyCoordinatedRelease(JSON.parse(readFileSync(manifest,'utf8')),{app,simulator,artifacts},undefined,{preflight:true})));}else{requireValue(args.length===5,'Usage: node scripts/verify-coordinated-release.mjs MANIFEST APP_ROOT SIMULATOR_ROOT ARTIFACT_ROOT OBSERVED_JSON');const [manifest,app,simulator,artifacts,observed]=args;console.log(JSON.stringify(verifyCoordinatedRelease(JSON.parse(readFileSync(manifest,'utf8')),{app,simulator,artifacts},JSON.parse(readFileSync(observed,'utf8')))));}}
 catch(error){console.error(error.message);process.exitCode=1;}
}
