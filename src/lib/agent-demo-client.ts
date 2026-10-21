import {createHash} from 'node:crypto';
import {z} from 'zod';

const uuid=z.string().uuid().refine(s=>s===s.toLowerCase());
const text=z.string().min(1).max(200).refine(s=>s.trim()===s&&!/[\u0000-\u001f\u007f]/.test(s));
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const source=z.object({sourcePersonId:uuid,sourceRevision:text,sourceFingerprint:hash}).strict();
const requestSchema=z.object({version:z.literal(1),demoId:uuid,organizationId:text,userId:text,mandateId:uuid,requestKey:uuid,people:z.array(source).min(1).max(50)}).strict().refine(v=>v.demoId===v.mandateId&&new Set(v.people.map(p=>p.sourcePersonId)).size===v.people.length);
const mapping=source.extend({simulatorLeadId:z.string().regex(/^lead-\d{3}$/),email:z.email(),phone:z.string().regex(/^\+999\d{12}$/),linkedin:z.url(),providerId:text}).strict();
const responseSchema=z.object({version:z.literal(1),runId:z.string().regex(/^[a-z][a-z0-9-]{2,63}$/),demoId:uuid,mappingDigest:hash,mappings:z.array(mapping).min(1).max(50),accounts:z.array(z.object({channel:z.enum(['email','whatsapp','linkedin']),providerAccountId:text,sourceId:text}).strict()).length(3),limits:z.object({participants:z.literal(999),modelCalls:z.number().int().min(0).max(300),perPerson:z.number().int().min(0).max(6),perPersonChannel:z.literal(2)}).strict(),usage:z.object({participants:z.number().int().min(0).max(999),modelCalls:z.number().int().min(0).max(300),remainingModelCalls:z.number().int().min(0).max(300)}).strict(),replayed:z.boolean()}).strict();
export type AgentDemoParticipantsRequest=z.infer<typeof requestSchema>;
export type AgentDemoParticipantsResult=z.infer<typeof responseSchema>;
export type AgentDemoControlConfiguration={endpoint:string;adminKey:string;expectedRunId?:string};
export class AgentDemoRecipientError extends Error{
 readonly name='AgentDemoRecipientError';
 readonly status:number;
 constructor(readonly reason:'source_conflict'|'capacity'){
  super(reason==='source_conflict'?'This demo could not be prepared. Your saved companies and people are still available; no outreach has started.':'The demo service has reached its test limit. Your saved companies and people are still available.');
  this.status=reason==='source_conflict'?409:503;
 }
}

function controlEndpoint(config:AgentDemoControlConfiguration|null){
 try{
  if(!config||!config.adminKey||config.adminKey.trim()!==config.adminKey||/[\r\n]/.test(config.adminKey))throw Error();
  const url=new URL(config.endpoint);
  // This adapter is the explicitly local testing-CLI transport. A future hosted
  // simulator needs its own reviewed configuration; never send this key to a
  // browser-provided URL or to the production communications provider.
  if(url.protocol!=='https:'||url.hostname!=='127.0.0.1'||!url.port||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error();
  return url.origin+'/sim/v1/demo/participants';
 }catch{throw Error('Demo recipients are unavailable. Configure the isolated testing service.');}
}

/** Call only with a mode loaded from the immutable mandate record and source
 * metadata checked against current membership/revisions. This prepares mapping
 * data; it does not persist app routes, choose a sender, approve or send. */
export async function prepareAgentDemoRecipients(mode:'real'|'demo',raw:unknown,config:AgentDemoControlConfiguration|null,fetcher:typeof fetch=fetch):Promise<{kind:'real'}|{kind:'demo';result:AgentDemoParticipantsResult}>{
 if(mode==='real')return {kind:'real'};
 const parsed=requestSchema.safeParse(raw);if(!parsed.success)throw Error('Invalid demo recipient request.');
 const input=parsed.data,url=controlEndpoint(config);
 let response:Response;
 try{response=await fetcher(url,{method:'POST',headers:{Authorization:'Bearer '+config!.adminKey,'Content-Type':'application/json'},body:JSON.stringify(input),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(5000)});}catch{throw Error('Demo recipients are unavailable. Retry the same request to reconcile it.');}
 if(!response.ok){
  // Only fixed local contract codes affect presentation. Never surface remote
  // messages, bodies, account identities or credentials to the browser/logs.
  let code:unknown;
  try{const body=await response.text();if(Buffer.byteLength(body)<=1000)code=JSON.parse(body)?.code;}catch{/* An unrecognized response retains the generic retry-safe failure. */}
  if(response.status===409&&code==='demo_source_changed')throw new AgentDemoRecipientError('source_conflict');
  if(response.status===409&&(code==='saved_recipient_limit'||code==='demo_participant_limit'))throw new AgentDemoRecipientError('capacity');
  throw Error('Demo recipients are unavailable. Retry the same request to reconcile it.');
 }
 try{
  const body=await response.text();if(Buffer.byteLength(body)>100000)throw Error();
  const result=responseSchema.parse(JSON.parse(body));
  if((config?.expectedRunId!==undefined&&result.runId!==config.expectedRunId)||result.demoId!==input.demoId||result.mappings.length!==input.people.length||new Set(result.accounts.map(a=>a.channel)).size!==3||result.usage.participants<result.mappings.length||result.usage.modelCalls>result.limits.modelCalls||result.usage.remainingModelCalls!==result.limits.modelCalls-result.usage.modelCalls)throw Error();
  for(const [i,m]of result.mappings.entries()){
   const p=input.people[i];
   if(m.sourcePersonId!==p.sourcePersonId||m.sourceRevision!==p.sourceRevision||m.sourceFingerprint!==p.sourceFingerprint||m.email!==`${m.simulatorLeadId}@${result.runId}.leads.acquire.test`||m.linkedin!==`https://www.linkedin.com/in/sim-${result.runId}-${m.simulatorLeadId}`||m.providerId!==`ACo_sim_${result.runId}_${m.simulatorLeadId}`)throw Error();
  }
  for(const key of ['simulatorLeadId','email','phone','linkedin','providerId'] as const)if(new Set(result.mappings.map(m=>m[key])).size!==result.mappings.length)throw Error();
  if(result.accounts.some(a=>a.providerAccountId!==`sim-${result.runId}-${a.channel}`||a.sourceId!==`sim-source-${a.channel}`))throw Error();
  const expected=createHash('sha256').update(JSON.stringify({version:1,runId:result.runId,demoId:input.demoId,organizationId:input.organizationId,userId:input.userId,mandateId:input.mandateId,mappings:result.mappings})).digest('hex');
  if(expected!==result.mappingDigest)throw Error();
  return {kind:'demo',result};
 }catch{throw Error('Demo recipients could not be verified. No outreach was enabled.');}
}
