import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir,rename,open,unlink} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
const channels=['email','whatsapp','linkedin'];
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
/** Normal Acquire routes only. Inject transports/persistence for isolated contract tests. */
export async function runAcquisitionDemoCanary(o){
 assert(o.execute===true,'Explicit execute opt-in required');assert(uuid(o.requestId),'Request UUID required');
 const origin=new URL(o.origin);assert(origin.protocol==='https:'&&origin.origin===o.origin,'Exact HTTPS application origin required');
 assert(typeof o.cookie==='string'&&o.cookie.startsWith('__Secure-better-auth.session_token=')&&!/[\r\n;]/.test(o.cookie),'One Acquire session cookie required');
 const required=o.requireChannels??['email'];assert(required.length>0&&required.every(c=>channels.includes(c))&&new Set(required).size===required.length,'Invalid required channels');
 const state=o.state;assert(state&&state.requestId===o.requestId,'Original saved request required');assert(!state.pendingMutation,'An unresolved mutation requires inspection before resuming');
 state.approved??=[];state.outbound??=[];assert(state.outbound.length<=5,'Initial approval limit exceeded');
 const fetcher=o.fetcher??fetch,sleep=o.sleep??(ms=>new Promise(r=>setTimeout(r,ms))),deadline=Date.now()+Math.min(o.timeoutMs??600000,900000);
 const save=()=>o.saveState(state),record=o.record??(async()=>{});
 async function request(path,body){
  assert(Date.now()<deadline,'Canary deadline reached');const method=body?'POST':'GET';
  if(body){assert(!state.pendingMutation,'An unresolved mutation requires inspection');state.pendingMutation={path,body};await save();}
  let response,text;
  try{response=await fetcher(origin.origin+path,{method,redirect:'error',headers:{cookie:o.cookie,origin:origin.origin,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(Math.max(1,Math.min(45000,deadline-Date.now())))});text=await response.text();}
  catch{await record({path,method,outcome:'transport_unavailable'});throw Error(body?'Mutation response ambiguous; inspect saved progress':'Read transport unavailable');}
  await record({path,method,status:response.status});
  if(!response.ok){if(body&&response.status>=400&&response.status<500){delete state.pendingMutation;await save();}throw Error(`Acquire HTTP ${response.status}; inspect recorded stage`);}
  let data;try{data=JSON.parse(text);}catch{throw Error(body?'Mutation response ambiguous; invalid JSON':'Invalid JSON response');}
  if(body){
   const confirmed=path==='/api/acquisition-workflows'?uuid(data?.id)&&uuid(data?.mandateId):path.endsWith('/reviews')?data?.batch?.id===body.batchId&&data.batch.state===body.decision:typeof data?.result?.status==='string';
   if(!confirmed)throw Error('Mutation response ambiguous; invalid receipt');
   delete state.pendingMutation;await save();
  }return data;
 }
 let workflow=await request('/api/acquisition-workflows?requestId='+o.requestId);
 if(workflow.status==='missing')workflow=await request('/api/acquisition-workflows',{requestId:o.requestId,preset:'demo',presentation:'agent'});
 const assertWorkflow=w=>assert(w&&uuid(w.id)&&uuid(w.mandateId)&&w.preset==='demo'&&w.presentation==='agent'&&typeof w.organizationId==='string'&&typeof w.ownerUserId==='string'&&(!state.executionId||state.executionId===w.id)&&(!state.mandateId||state.mandateId===w.mandateId),'Original owned demo workflow required');
 assertWorkflow(workflow);state.executionId=workflow.id;state.mandateId=workflow.mandateId;await save();
 while(!['ready','outreach'].includes(workflow.state)){assert(!['failed','cancelled','uncertain','complete'].includes(workflow.state),'Workflow stopped');await sleep(30000);workflow=await request('/api/acquisition-workflows?requestId='+o.requestId);assertWorkflow(workflow);}
 const base='/api/mandates/'+workflow.mandateId+'/agent';
 const checkState=s=>assert(s?.executionMode==='demo'&&s.workflowPreset==='demo'&&s.workflowExecutionId===workflow.id,'Original demo execution required');
 let execution=await request(base+'/execution');if(execution.state)checkState(execution.state);
 if(execution.state?.responsibility)assert(uuid(state.controlKey)&&uuid(state.demoKey),'Original phase keys required for existing responsibility');
 else{state.controlKey??=randomUUID();state.demoKey??=randomUUID();await save();assert(typeof(execution.state?.mandateRevision??execution.mandateRevision)==='string','Current mandate revision required');await request(base+'/execution',{action:'start',requestKey:state.controlKey,expectedRevision:0,mandateRevision:execution.state?.mandateRevision??execution.mandateRevision});}
 const approved=new Set(state.approved),outbound=new Set(state.outbound),verified=new Set();
 while(Date.now()<deadline){
  execution=await request(base+'/execution');checkState(execution.state);const s=execution.state;assert(['ready','waiting'].includes(s.responsibility?.state),'Active responsibility required');
  const result=await request(base+'/reviews');assert(Array.isArray(result.batches),'Invalid reviews response');
  if(!state.prepared&&!(s.contactAllocation?.allocated>0)&&!s.conversations?.length&&!result.batches.length){await request(base+'/demo',{action:'start',requestKey:state.demoKey});state.prepared=true;await save();continue;}
  for(const batch of result.batches){
   if(approved.has(batch.id)||batch.state!=='pending'||batch.stale===true)continue;
   assert(batch.organization_id===workflow.organizationId&&batch.owner_user_id===workflow.ownerUserId&&batch.mandate_id===workflow.mandateId&&batch.thread_id===s.responsibility.thread_id,'Foreign review ownership');
   const ops=batch.operations;assert(Array.isArray(ops)&&ops.length>0&&ops.length<=5,'Review operation limit');
   const selection=ops.every(p=>p.name==='target.select'),initial=ops.every(p=>/^(email|whatsapp|linkedin)\.initial$/.test(p.name));if(!selection&&!initial||selection&&state.selectionApproved)continue;
   assert(Array.isArray(batch.manifest)&&batch.manifest.length===ops.length&&new Set(batch.manifest.map(i=>i.operationId)).size===ops.length&&batch.manifest.every(i=>ops.some(p=>p.id===i.operationId&&p.revision===i.revision&&p.input_digest===i.digest&&p.state==='proposed')),'Exact review manifest required');
   if(initial){for(const op of ops)outbound.add(op.id);assert(outbound.size<=5,'Initial approval limit exceeded');state.outbound=[...outbound];await save();}
   await request(base+'/reviews',{action:'decide',batchId:batch.id,revision:batch.revision,items:batch.manifest,decision:'approved',approvalSource:'automatic_demo'});
   approved.add(batch.id);state.approved=[...approved];if(selection)state.selectionApproved=true;await save();
  }
  for(const id of outbound){const op=await request(base+'/operations?operationId='+encodeURIComponent(id)+'&include=history');assert(op.operationId===id&&channels.includes(op.channel)&&op.name===op.channel+'.initial','Original initial operation required');const submitted=Date.parse(op.delivery?.submittedAt);
   if(op.delivery?.status==='submitted'&&typeof op.delivery.providerMessageId==='string'&&op.delivery.providerMessageId&&Number.isFinite(submitted)&&op.history?.messages?.some(m=>m.direction==='inbound'&&m.channel===op.channel&&typeof m.text==='string'&&m.text.trim()&&Number.isFinite(Date.parse(m.at))&&Date.parse(m.at)>=submitted))verified.add(op.channel);
  }
  if(required.every(c=>verified.has(c))){const verifiedChannels=channels.filter(c=>verified.has(c));return{passed:true,executionId:workflow.id,mandateId:workflow.mandateId,verifiedChannels,allThreeChannelsVerified:channels.every(c=>verified.has(c))};}
  await sleep(Math.min(30000,Math.max(0,deadline-Date.now())));
 }
 throw Error('No confirmed message/reply by deadline; saved evidence retained');
}
async function main(){
 const args=process.argv.slice(2),value=name=>args[args.indexOf(name)+1];assert(args.includes('--execute'),'Pass --execute explicitly');
 const cookieFile=resolve(value('--cookie-file')??''),dir=resolve(value('--evidence-dir')??'');assert(cookieFile.includes(sep+'.local-data'+sep)&&dir.includes(sep+'.local-data'+sep),'Use ignored .local-data paths');
 const requestId=value('--request-id');assert(uuid(requestId),'Pass --request-id UUID');await mkdir(dir,{recursive:true,mode:0o700});
 const lockPath=resolve(dir,'run.lock'),lock=await open(lockPath,'wx',0o600);
 try{
 const stateFile=resolve(dir,'state.json');let state;try{state=JSON.parse(await readFile(stateFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;state={requestId,approved:[],outbound:[]};}
 const saveState=async s=>{const temporary=stateFile+'.tmp';await writeFile(temporary,JSON.stringify(s),{mode:0o600});await rename(temporary,stateFile);};
 let count=0;const record=async e=>writeFile(resolve(dir,`${Date.now()}-${process.pid}-${++count}.json`),JSON.stringify({...e,at:new Date().toISOString()}),{mode:0o600,flag:'wx'});
 const result=await runAcquisitionDemoCanary({execute:true,origin:value('--origin'),requestId,cookie:(await readFile(cookieFile,'utf8')).trim(),state,saveState,record,...(args.includes('--require-channels')?{requireChannels:value('--require-channels').split(',')}: {})});await record(result);console.log(JSON.stringify(result));
 }finally{await lock.close();await unlink(lockPath);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(()=>{console.error('Canary stopped; inspect private stage/progress files. No automatic resend.');process.exitCode=1;});
