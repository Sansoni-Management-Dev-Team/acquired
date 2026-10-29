/** Production HTTP canary. Explicit --execute required; never sends outreach.
 * Uses only supported workflow fields. Organisation research limits remain intact.
 * Stopping this observer does not cancel a saved research job.
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
const base='https://acquire.mlai.au';
const dir=resolve(process.env.CANARY_OUTPUT_DIR||'.local-data/workflow-modularity/canary/live-research');
const keys=['subsectors','geography','revenue','revenueCeiling','headcount','ebitda','margin','accreditations','management','ownerDependence','multiple','payback','vendorMotivation','sellerEngagement','property','structure','concentration','timing','dealBreakers'];
const requestId=process.env.CANARY_REQUEST_ID||randomUUID();
if(!/^[a-f0-9-]{36}$/i.test(requestId))throw Error('Invalid request ID');
const payload={requestId,preset:'live-research-test',presentation:'workspace',brief:{name:`Production research canary ${requestId.slice(0,8)}`,naturalLanguage:'Research established commercial refrigeration maintenance and repair businesses in Tasmania. This is a research-only test; do not contact anyone.',researchSources:[],investmentThesis:'',outreachPositioning:'',disclosureApproved:false,criteria:keys.map(key=>({key,value:key==='subsectors'?'Commercial refrigeration maintenance and repair':key==='geography'?'TAS':'',importance:'preference',origin:'supplied',state:['subsectors','geography'].includes(key)?'specified':'unknown',confirmed:['subsectors','geography'].includes(key)}))}};
await mkdir(dir,{recursive:true,mode:0o700});
const payloadFile=resolve(dir,`${requestId}.request.json`);
await writeFile(payloadFile,JSON.stringify(payload,null,2),{mode:0o600});
if(!process.argv.includes('--execute')){console.log(JSON.stringify({prepared:true,requestId,payloadFile,endpoint:base+'/api/acquisition-workflows',outreach:'disabled',executed:false}));process.exit(0);}
const cookieFile=resolve(process.env.CANARY_COOKIE_FILE||'.local-data/workflow-modularity/canary/acquire-cookie.private.txt');
const cookie=(await readFile(cookieFile,'utf8')).trim().replace(/^Cookie:\s*/i,'');
if(!cookie||/[\r\n]/.test(cookie))throw Error('Expected one private Cookie header');
const evidence={requestId,startedAt:new Date().toISOString(),requests:[],outcome:'pending'};
const file=resolve(dir,`${requestId}.evidence.json`);
async function save(){await writeFile(file,JSON.stringify(evidence,null,2),{mode:0o600});}
async function request(path,method='GET',body){
 const started=performance.now();
 try{
  const response=await fetch(base+path,{method,headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000),redirect:'error'});
  const text=await response.text();let json;try{json=JSON.parse(text);}catch{json={parseError:true,bodyLength:text.length};}
  evidence.requests.push({at:new Date().toISOString(),method,path,status:response.status,durationMs:Math.round(performance.now()-started),body:json});await save();
  return{ok:response.ok,status:response.status,body:json};
 }catch(error){evidence.requests.push({at:new Date().toISOString(),method,path,durationMs:Math.round(performance.now()-started),error:error.name});await save();return{ok:false,status:0,body:{}};}
}
const created=await request('/api/acquisition-workflows','POST',payload);
let state=created.body;
if(!created.ok){
 // A timeout is ambiguous: read the same UUID; never mint a replacement.
 const recovered=await request('/api/acquisition-workflows?requestId='+requestId);state=recovered.body;
 if(!recovered.ok||state.id!==requestId){evidence.outcome='admission-not-confirmed';await save();console.log(JSON.stringify({requestId,outcome:evidence.outcome,evidence:file}));process.exitCode=1;}
}
if(state.id===requestId){
 const maxSeconds=Math.min(900,Math.max(10,Number(process.env.CANARY_POLL_SECONDS||180))),deadline=Date.now()+maxSeconds*1000;
 while(Date.now()<deadline){
  if(state.preset!=='live-research-test')throw Error('Unexpected workflow preset');
  if(['ready','outreach'].includes(state.state))throw Error('Research-only workflow entered outreach-capable state');
  if(['complete','failed','cancelled','uncertain'].includes(state.state))break;
  await new Promise(resolve=>setTimeout(resolve,5000));
  const next=await request('/api/acquisition-workflows?requestId='+requestId);if(next.ok&&next.body.id===requestId)state=next.body;
 }
 evidence.outcome=state.state==='complete'?'research-complete':`observed-${state.state}`;
 // Normal owned workspace route supplies saved counts and provider progress.
 if(state.mandateId)await request(`/api/mandates/${state.mandateId}/research`);
 await save();console.log(JSON.stringify({requestId,mandateId:state.mandateId,state:state.state,outcome:evidence.outcome,evidence:file}));
 if(state.state!=='complete')process.exitCode=1;
}
