import 'server-only';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {CampaignActor} from '@/db/campaign-client';
import type {AgentChannelPolicyInput} from '@/domain/agent-person-channel';
type Channel='email'|'whatsapp'|'linkedin';
type Account={channel:Channel;bindingId:string;bindingDigest:string;eligibleForNewWork?:boolean;isDefault?:boolean};
type Policy={revision:number;channelOrder:Channel[];bindings:{channel:Channel;bindingId:string;bindingDigest:string}[]};
type Store={
 executionState(threadId:string):Promise<{executionMode:'demo'|'real';workflowExecutionId?:string;workflowPreset?:'demo'|'live'|'live-research-test';mandateRevision:string;responsibility:null|{state:string;mandate_revision?:string};demoContacts?:{prepared:number;stale:number}}>;
 channelPolicy(threadId:string):Promise<{policy:Policy|null;accounts:Account[]}>;
 demoOutreachAccounts(threadId:string):Promise<{channel:Channel;bindingId:string;bindingDigest:string}[]>;
 saveChannelPolicy(threadId:string,key:string,input:AgentChannelPolicyInput):Promise<{revision:number}>;
 proposeTargetSelection(threadId:string,key:string,input:{mode:'channels';policyRevision:number}):Promise<unknown>;
};
export class AgentOutreachStartError extends Error{}
function initialChannelDefaults(accounts:Account[]):AgentChannelPolicyInput|undefined{
 const available=accounts.filter(a=>a.eligibleForNewWork!==false),bindings:{channel:Channel;bindingId:string}[]=[];
 for(const channel of ['email','whatsapp','linkedin'] as const){
  const choices=available.filter(a=>a.channel===channel);if(!choices.length)continue;
  const defaults=choices.filter(a=>a.isDefault===true),selected=defaults.length===1?defaults[0]:defaults.length===0&&choices.length===1?choices[0]:undefined;
  if(!selected)return;bindings.push({channel,bindingId:selected.bindingId});
 }
 return bindings.length?{expectedRevision:0,channelOrder:bindings.map(b=>b.channel),bindings,delaySeconds:86400,acceleratedSimulation:false}:undefined;
}
/** Start/resume may inherit current new-work defaults. Existing mandate choices
 * are immutable here; missing choices never block independent company research. */
export async function initializeAgentChannelDefaults(store:Pick<Store,'channelPolicy'|'saveChannelPolicy'>,threadId:string,requestKey:string){
 const current=await store.channelPolicy(threadId);if(current.policy)return 'saved' as const;
 const input=initialChannelDefaults(current.accounts);if(!input)return 'needs_settings' as const;
 await store.saveChannelPolicy(threadId,phaseKey(requestKey,'policy'),input);return 'initialized' as const;
}
/** Separate deterministic phase keys retain existing command replay and contact
 * preparation receipts after a lost response. No dispatch or approval here. */
export function phaseKey(key:string,phase:string){
 const b=createHash('sha256').update(`acquire.outreach-start.v1:${key}:${phase}`).digest().subarray(0,16);
 b[6]=(b[6]&15)|128;b[8]=(b[8]&63)|128;const h=b.toString('hex');
 return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
export async function startAgentOutreach({actor,mandateId,threadId,requestKey,store,prepare}:{actor:CampaignActor;mandateId:string;threadId:string;requestKey:string;store:Store;prepare:(actor:CampaignActor,mandateId:string,key:string)=>Promise<unknown>}){
 for(const id of [mandateId,threadId,requestKey])z.string().uuid().parse(id);
 const started=performance.now();
 const observe=(stage:string)=>console.info('agent-start-outreach',JSON.stringify({module:'agent-start-outreach',mandateId,threadId,stage,elapsedMs:Math.round(performance.now()-started),timestamp:new Date().toISOString()}));
 const state=await store.executionState(threadId);
 if(state.workflowPreset==='live-research-test')throw new AgentOutreachStartError('This research-only run does not prepare outreach.');
 if(state.executionMode!=='demo'&&state.workflowPreset!=='live')throw new AgentOutreachStartError('This start action is for saved-data demos.');
 if(!state.responsibility||!['ready','waiting'].includes(state.responsibility.state)||state.responsibility.mandate_revision!==state.mandateRevision)throw new AgentOutreachStartError('Resume the agent with the current brief before starting outreach.');
 observe('start_requested');
 if(state.executionMode==='demo'&&(!state.demoContacts?.prepared||state.demoContacts.stale>0))await prepare(actor,mandateId,phaseKey(requestKey,'recipients'));
 observe('recipients_prepared');
 // The account list may include several historical demo runs. Intersect with
 // the immutable run actually recorded on this mandate's prepared recipients.
 const current=await store.channelPolicy(threadId);
 if(state.executionMode==='demo'){const senders=await store.demoOutreachAccounts(threadId);current.accounts=current.accounts.filter(a=>senders.some(s=>s.channel===a.channel&&s.bindingId===a.bindingId&&s.bindingDigest===a.bindingDigest));}
 let revision=current.policy?.revision;
 if(current.policy){
  if(current.policy.channelOrder.some(channel=>!current.policy!.bindings.some(b=>b.channel===channel&&current.accounts.some(a=>a.channel===channel&&a.bindingId===b.bindingId&&a.bindingDigest===b.bindingDigest&&a.eligibleForNewWork!==false))))throw new AgentOutreachStartError('An outreach account changed. Check its connection in Settings.');
 }else{
  const input=initialChannelDefaults(current.accounts);
  if(!input)throw new AgentOutreachStartError('Choose a default account for each connected channel in Settings, then press Start.');
  const saved=await store.saveChannelPolicy(threadId,phaseKey(requestKey,'policy'),input);revision=saved.revision;
 }
 observe('channel_defaults_saved');
 const result=await store.proposeTargetSelection(threadId,phaseKey(requestKey,'contacts'),{mode:'channels',policyRevision:revision!});
 // A proposed selection has no conversations yet. Allocation owns the
 // transition to outreach once its durable conversation rows exist.
 observe('contact_selection_prepared');return result;
}
