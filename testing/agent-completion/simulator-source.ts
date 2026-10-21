import{open,realpath}from'node:fs/promises';import{constants}from'node:fs';import{createHash}from'node:crypto';import{isAbsolute,join,resolve}from'node:path';import{pathToFileURL}from'node:url';
export const COMPLETION_SIMULATOR_FILES=['core.mjs','demo-contract.mjs','clock-owner.mjs','deep-profile.mjs','provider.mjs','remote-clock.mjs','local-model-fixture.mjs']as const;
/** Explicit source snapshot, reviewed and frozen by the owning build. Every
 * transitive local import of these entries is included; nothing is copied. */
export async function loadCompletionSimulator(input:{root:string;sha256:Record<string,string>}){
 if(!input||typeof input.root!=='string'||!isAbsolute(input.root)||input.root!==resolve(input.root)||!input.sha256||Object.keys(input.sha256).sort().join()!==[...COMPLETION_SIMULATOR_FILES].sort().join()||Object.values(input.sha256).some(value=>typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value)))throw Error('Simulator manifest unavailable');
 const root=input.root,hashes=Object.freeze({...input.sha256});
 try{
  if(await realpath(root)!==root)throw Error();
  for(const name of COMPLETION_SIMULATOR_FILES){const file=await open(join(root,name),constants.O_RDONLY|constants.O_NOFOLLOW);try{const info=await file.stat();if(!info.isFile()||info.size>1000000||createHash('sha256').update(await file.readFile()).digest('hex')!==hashes[name])throw Error();}finally{await file.close();}}
 }catch{throw Error('Simulator source mismatch');}
 const load=(name:string):Promise<Record<string,unknown>>=>import(/* @vite-ignore */ pathToFileURL(join(root,name)).href);
 return{root,sha256:hashes,deepProfile:await load('deep-profile.mjs'),provider:await load('provider.mjs'),remoteClock:await load('remote-clock.mjs'),localModel:await load('local-model-fixture.mjs')};
}
