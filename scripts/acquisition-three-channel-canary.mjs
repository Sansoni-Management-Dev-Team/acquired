/** Sequential, resumable wrapper. Config contains file paths/owned test identities;
 * cookies stay in their private file. Never retries an ambiguous mutation. */
import assert from 'node:assert/strict';
import{randomUUID}from'node:crypto';
import{mkdir,readFile,writeFile,rename,open,unlink}from'node:fs/promises';
import{resolve}from'node:path';
import{pathToFileURL}from'node:url';
import{channelCanaryCreationScope,runAcquisitionChannelCanary}from'./acquisition-channel-canary.mjs';
export async function runThreeChannelCanaries({config,load,save,record,lockChannel=async()=>async()=>{},runner=runAcquisitionChannelCanary}){
 const results=[];
 for(const channel of['email','whatsapp','linkedin']){
  const release=await lockChannel(channel);try{
  const state=await load(channel)??{channel,requestId:randomUUID()};
  const expectedScope={origin:config.origin,owner:config.expectedOwnerId,organization:config.expectedOrganizationId,binding:config.bindings[channel],run:config.simulatorRun};
  if(state.creation)assert.deepEqual(state.creation,channelCanaryCreationScope(config),'Completed creation strategy changed');
  if(state.scope)assert.deepEqual(state.scope,expectedScope,'Completed journal scope changed');
  await save(channel,state);
  assert(!state.pendingMutation&&!state.pendingAcceptance,'Unresolved channel mutation requires inspection');
  if(state.verifiedResult){assert(state.verifiedResult.passed===true&&state.verifiedResult.channel===channel&&state.verifiedResult.mandateId===state.mandateId&&state.verifiedResult.operationId===state.messageOperationId&&state.verifiedResult.conversationId===state.conversationId,'Saved result identity mismatch');results.push(state.verifiedResult);continue;}
  const result=await runner({...config,execute:true,channel,requestId:state.requestId,state,expectedBindingId:config.bindings[channel],saveState:s=>save(channel,s),record:e=>record(channel,e)});
  await record(channel,result);results.push(result);
  if(!result.passed)return{passed:false,results};
  state.verifiedResult=result;await save(channel,state);
  }finally{await release();}
 }
 return{passed:true,results};
}
async function main(){
 const args=process.argv.slice(2),value=k=>args[args.indexOf(k)+1];assert(args.includes('--execute')&&args.includes('--config'),'Use --execute --config <private.json>');
 const configPath=resolve(value('--config'));assert(configPath.includes('/.local-data/'),'Private configuration required');
 const config=JSON.parse(await readFile(configPath,'utf8')),dir=resolve(config.evidenceDir);assert(dir.includes('/.local-data/'),'Private evidence directory required');
 await mkdir(dir,{recursive:true,mode:0o700});const lockPath=resolve(dir,'all.lock'),lock=await open(lockPath,'wx',0o600);
 try{const cookie=(await readFile(resolve(config.cookieFile),'utf8')).trim();let n=0;
 const result=await runThreeChannelCanaries({config:{...config,cookie},lockChannel:async channel=>{const path=resolve(dir,channel+'.lock'),handle=await open(path,'wx',0o600);return async()=>{await handle.close();await unlink(path);};},load:async channel=>{try{return JSON.parse(await readFile(resolve(dir,channel+'.json'),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}},save:async(channel,state)=>{const path=resolve(dir,channel+'.json');await writeFile(path+'.tmp',JSON.stringify(state,null,2),{mode:0o600});await rename(path+'.tmp',path);},record:async(channel,e)=>writeFile(resolve(dir,`${channel}-${Date.now()}-${++n}.json`),JSON.stringify(e),{mode:0o600,flag:'wx'})});
 console.log(JSON.stringify(result));
 }finally{await lock.close();await unlink(lockPath);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(()=>{console.error('Stopped; inspect private journals. No automatic resend.');process.exitCode=1;});
