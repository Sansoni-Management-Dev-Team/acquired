import {z} from 'zod';
import {containsAgentOutboundLink} from '@/domain/agent-execution';
export const pilotRunId='agent-conversations-25-20261017';
export const pilotMandateId='e7da3f8c-8c45-4aef-bac4-392b918e0025';
export const isolatedPilotMandateId='e7da3f8c-8c45-4aef-bac4-392b918e0026';
export const fiftyPilotRunId='agent-conversations-50-20261017';
export const fiftyPilotMandateId='e7da3f8c-8c45-4aef-bac4-392b918e0050';
export function pilotProfile(runId:string){
 if(runId===pilotRunId)return {runId,mandates:[pilotMandateId,isolatedPilotMandateId],organizationId:null,count:25,origin:'https://127.0.0.1:5590',prefix:'pilot25',directory:'/tmp/acquire-agent-pilot25',caps:{calls:'200',sends:'75',usd_micro:'1000000'}};
 if(runId===fiftyPilotRunId)return {runId,mandates:[fiftyPilotMandateId],organizationId:'8d583d4c-68ac-4f43-9e06-483b3cf5d050',count:50,origin:'https://127.0.0.1:5690',prefix:'pilot50',directory:'/tmp/acquire-agent-pilot50',caps:{calls:'400',sends:'100',usd_micro:'2000000'}};
 throw Error('Exact known local pilot profile required');
}
export const pilotConfigSchema=z.object({runId:z.enum([pilotRunId,fiftyPilotRunId]),mandateId:z.string().uuid().default(pilotMandateId),actor:z.object({organizationId:z.string().min(1).max(200),userId:z.string().min(1).max(200)}).strict(),bindingId:z.string().uuid(),buyerContext:z.string().min(20).max(2000).refine(value=>value.includes('[SIMULATED]'),'Fictional public buyer facts must be labelled'),leads:z.array(z.object({id:z.string().regex(/^lead-[0-9]{3}$/),email:z.string(),name:z.string().min(1).max(150),company:z.string().min(1).max(150)}).strict()).max(50)}).strict().superRefine((value,context)=>{const profile=pilotProfile(value.runId);if(!profile.mandates.includes(value.mandateId)||profile.organizationId&&value.actor.organizationId!==profile.organizationId||value.leads.length!==profile.count||new Set(value.leads.map(lead=>lead.id)).size!==profile.count||value.leads.some(lead=>Number(lead.id.slice(5))<1||Number(lead.id.slice(5))>profile.count||lead.email!==lead.id+'@'+value.runId+'.leads.acquire.test'))context.addIssue({code:'custom',message:'Exact distinct simulator profile, mandate, owner and recipients required'});});
export type PilotConfig=z.infer<typeof pilotConfigSchema>;
export function assertPilotEnvironment(config:PilotConfig,env:Record<string,string|undefined>){const profile=pilotProfile(config.runId);if(env.NODE_ENV==='production'||env.AGENT_MODE_COMMUNICATIONS_MODE!=='simulator'||env.UNIPILE_API_URL!==profile.origin||env.COMMUNICATIONS_LOCAL_SIMULATOR_ORIGIN!==profile.origin)throw Error('Exact local simulator profile required');}
export function createPilotBudgets(now:Date,runId:string=pilotRunId){const profile=pilotProfile(runId),windowStart=new Date(now);windowStart.setUTCHours(0,0,0,0);return (['organization','user','mandate'] as const).flatMap(scope=>(['calls','usd_micro','sends'] as const).map(unit=>({scope,unit,cap:profile.caps[unit],windowStart:windowStart.toISOString(),windowEnd:new Date(windowStart.getTime()+86400000).toISOString()})));}
type Review={id:string;revision:number;state:string;stale?:boolean;manifest:unknown[];operations:{id:string;name:string;revision:number;input:Record<string,unknown>}[]};
/** An operator must export/read the exact complete review file first. This
 * validator is an additional fixture boundary, never a replacement for the
 * store's current manifest, owner, source, approval or dispatch checks. */
export function validatePilotReview(raw:unknown,presented:Review,current:Review){
 const config=pilotConfigSchema.parse(raw),permitted=new Set(config.leads.map(lead=>'email:'+lead.email));
 if(presented.id!==current.id||presented.revision!==current.revision||JSON.stringify(presented.manifest)!==JSON.stringify(current.manifest)||JSON.stringify(presented.operations)!==JSON.stringify(current.operations)||current.state!=='pending'||current.stale||!current.operations.length)throw Error('Exact current operator-reviewed manifest required');
 for(const operation of current.operations){
  if(operation.name==='target.select'){
   const delivery=operation.input.delivery as {mode?:string;bindingId?:string}|undefined,selected=operation.input.selected as {recipient?:string}[]|undefined;
   if(delivery?.mode!=='communications'||delivery.bindingId!==config.bindingId||!selected?.length||selected.length>5||selected.some(contact=>!permitted.has('email:'+contact.recipient)))throw Error('Exact simulated target/account scope required');
  }else if(['email.initial','email.reply','email.follow_up'].includes(operation.name)){
   if(!permitted.has(String(operation.input.recipientKey))||typeof operation.input.subject!=='string'||typeof operation.input.body!=='string'||!operation.input.body.trim()||containsAgentOutboundLink(operation.input.subject)||containsAgentOutboundLink(operation.input.body))throw Error('Only scoped link-free simulated email drafts may be approved');
  }else throw Error('Pilot review cannot approve another tool');
 }
 return true;
}

/** Lookup has no permission to prepare or submit a replacement operation. */
export function validatePilotOriginalLookup(raw:unknown,record:{bindingId:string|null;deliveryMode:string;recipient:string}){const config=pilotConfigSchema.parse(raw);if(record.bindingId!==config.bindingId||record.deliveryMode!=='communications'||!config.leads.some(lead=>lead.email===record.recipient))throw Error('Exact original simulated communications record required');}

export async function approvePilotSequentially(ids:string[],ports:{approve:(id:string)=>Promise<void>;lookup:(id:string)=>Promise<'submitted'|'not_submitted'|'unknown'>;now:()=>number;wait:()=>Promise<void>},timeoutMs=45000){const completed:string[]=[];for(const id of ids){const until=ports.now()+timeoutMs;await ports.approve(id);for(;;){const status=await ports.lookup(id);if(status==='submitted'){completed.push(id);break;}if(status==='not_submitted'||ports.now()>=until)return {completed,stopped:id,status};await ports.wait();}}return {completed,stopped:null,status:'submitted' as const};}

export function pilotOriginalNeedsRecovery(state:string){return state==='uncertain';}

export function pilotReceiptHold(row:{phase:string;pause_reason?:string|null}){return row.phase==='held'&&row.pause_reason==='provider_receipt_pending_history';}

export function validatePilotReassessment(raw:unknown,candidate:{conversationId:string;recipient:string;revision:number;epoch:string|number;contextRevision:string;latestInboundId:string},current:{id:string;recipient_email:string;binding_id:string|null;phase:string;driver_kind:string;revision:number;epoch:string|number;context_revision:string;history:{id:string;direction:string}[]}){const config=pilotConfigSchema.parse(raw),latestInbound=[...current.history].reverse().find(h=>h.direction==='inbound');if(current.id!==candidate.conversationId||!config.leads.some(lead=>lead.email===candidate.recipient)||current.recipient_email!==candidate.recipient||current.binding_id!==config.bindingId||current.phase!=='active'||current.driver_kind!=='agent'||current.revision!==candidate.revision||String(current.epoch)!==String(candidate.epoch)||current.context_revision!==candidate.contextRevision||latestInbound?.id!==candidate.latestInboundId)throw Error('Exact current active pre-model reassessment context required');}

/** Full human-approved facts remain in the separate guidance proposal; the brief has a smaller field limit. */
export function pilotBriefPositioning(config:PilotConfig){return config.buyerContext.length<=1500?config.buyerContext:'[SIMULATED] Explore an optional, non-binding introductory conversation using only separately reviewed public buyer guidance. Business fit and private financial facts remain unverified. Ask the human about missing information; only the human sends a booking link.';}

export function selectPilotReceiptConversations<T extends {id:string;recipient_email:string;phase:string;pause_reason?:string|null}>(raw:unknown,rows:T[],conversationId?:string){const config=pilotConfigSchema.parse(raw);if(conversationId){const row=rows.find(candidate=>candidate.id===conversationId);if(!row||!config.leads.some(lead=>lead.email===row.recipient_email))throw Error('Exact owned pilot conversation required');return pilotReceiptHold(row)?[row]:[];}return rows.filter(pilotReceiptHold);}
