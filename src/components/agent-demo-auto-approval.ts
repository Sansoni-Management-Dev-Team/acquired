import type {AgentReviewBatchView} from './agent-review-cards';
import {nativeProposalReviewable} from '@/domain/agent-native-proposal-review';
import {agentContactReviewBatchSize} from '@/domain/agent-mode';
export type AgentDemoAutoApprovalSelection={contacts:boolean;initialMessages:boolean;replies:boolean;followUps:boolean;connectionRequests:boolean;bookingLinks:boolean;reviewFlaggedDrafts:boolean};
export const AGENT_DEMO_AUTO_APPROVAL_OFF:Readonly<AgentDemoAutoApprovalSelection>=Object.freeze({contacts:false,initialMessages:false,replies:false,followUps:false,connectionRequests:false,bookingLinks:false,reviewFlaggedDrafts:false});
export const AGENT_DEMO_AUTO_APPROVAL_ALL:Readonly<AgentDemoAutoApprovalSelection>=Object.freeze({contacts:true,initialMessages:true,replies:true,followUps:true,connectionRequests:true,bookingLinks:true,reviewFlaggedDrafts:true});
/** Presentation selection only. Requires the trusted local demo gate at its caller;
 * every approval still goes through the original exact server review command. */
const hash=/^[a-f0-9]{64}$/,uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,revision=/^[1-9]\d{0,29}$/;
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const positive=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>0;
function category(name:string):Exclude<keyof AgentDemoAutoApprovalSelection,'reviewFlaggedDrafts'>|undefined{
 if(name==='target.select')return 'contacts';
 if(name==='linkedin.invitation')return 'connectionRequests';
 if(name==='email.manual_link')return 'bookingLinks';
 if(/^(email|whatsapp|linkedin)\.initial$/.test(name))return 'initialMessages';
 if(/^(email|whatsapp|linkedin)\.reply$/.test(name))return 'replies';
 if(/^(email|whatsapp|linkedin)\.follow_up$/.test(name))return 'followUps';
}
/** Named aliases bind the original run. Reserved phones are opaque hashed values,
 * never a source of lead IDs; exact mapping remains a server admission check. */
function leadAlias(channel:unknown,value:unknown):string|undefined{
 if(typeof value!=='string')return undefined;
 const run='(agent-real-research-demos|agent-deep-[a-z0-9][a-z0-9-]{0,36})';
 if(channel==='email'){const match=new RegExp('^lead-(\\d{3})@'+run+'\\.leads\\.acquire\\.test$').exec(value);return match?match[2]+':'+match[1]:undefined;}
 if(channel==='whatsapp')return /^\+999\d{12}$/.test(value)?value:undefined;
 if(channel==='linkedin'){const match=new RegExp('^https://www\\.linkedin\\.com/in/sim-'+run+'-lead-(\\d{3})$').exec(value);return match?match[1]+':'+match[2]:undefined;}
}
function exactPendingBatch(batch:AgentReviewBatchView,editedBatchId?:string|null){
 if(!batch.id||batch.id.length>200||batch.id===editedBatchId||batch.state!=='pending'||batch.stale!==false||!positive(batch.revision)||!batch.operations.length||batch.operations.length>50||batch.operations.length!==batch.manifest.length||new Set(batch.operations.map(op=>op.id)).size!==batch.operations.length||new Set(batch.manifest.map(item=>item.operationId)).size!==batch.manifest.length)return false;
 return batch.operations.every(op=>{const item=batch.manifest.find(item=>item.operationId===op.id);return Boolean(op.id)&&op.id.length<=200&&op.state==='proposed'&&positive(op.revision)&&Boolean(item)&&item!.revision===op.revision&&hash.test(item!.digest)&&hash.test(item!.contextRevision)&&op.input.contextRevision===item!.contextRevision&&nativeProposalReviewable(op.name,op.input);});
}
function simulatedMessage(op:AgentReviewBatchView['operations'][number]){
 if(typeof op.input.body!=='string'||!op.input.body.trim()||!hash.test(String(op.input.bindingDigest??''))||typeof op.input.recipientKey!=='string')return false;
 const channel=op.name.split('.')[0],prefix=channel+':';
 return op.input.recipientKey.startsWith(prefix)&&Boolean(leadAlias(channel,op.input.recipientKey.slice(prefix.length)));
}
function simulatedContactPlan(input:Record<string,unknown>){
 const delivery=record(input.delivery);
 if(input.nativeTargetSelectionVersion!==1||delivery.mode!=='channels'||!positive(delivery.policyRevision)||!revision.test(String(input.mandateRevision??''))||!uuid.test(String(input.responsibilityId??''))||!positive(input.responsibilityRevision)||!Array.isArray(input.selected)||!input.selected.length||input.selected.length>agentContactReviewBatchSize)return false;
 const contacts=new Set<string>(),leads=new Set<string>(),recipients=new Set<string>(),accounts=new Map<string,string>();let expectedChannels:string|undefined;
 return input.selected.every(raw=>{
  const person=record(raw),contactId=String(person.contactId??'');
  if(!uuid.test(contactId)||contacts.has(contactId)||!hash.test(String(person.sourceRevision??''))||typeof person.qualificationConfirmed!=='boolean'||!Array.isArray(person.channels)||!person.channels.length||person.channels.length>3)return false;
  contacts.add(contactId);
  const selectedLead=person.recipient===''?undefined:leadAlias('email',person.recipient);
  if(person.recipient!==''&&!selectedLead)return false;
  const channels=new Set<string>(),bindingIds=new Set<string>();let routeLead=selectedLead;
  for(const rawRoute of person.channels){
   const route=record(rawRoute),recipient=record(route.recipient),identity=record(route.identityProof),channel=String(route.channel??''),bindingId=String(route.bindingId??''),bindingDigest=String(route.bindingDigest??''),kind=channel==='email'?'email':channel==='whatsapp'?'phone':channel==='linkedin'?'linkedin_profile':undefined,lead=leadAlias(channel,recipient.value);
   if(!kind||recipient.kind!==kind||!lead||channel!=='whatsapp'&&routeLead&&lead!==routeLead||recipients.has(channel+':'+String(recipient.value))||channels.has(channel)||bindingIds.has(bindingId)||!uuid.test(bindingId)||!hash.test(bindingDigest)||identity.kind!=='recorded_contact'||!/^([1-9]\d{0,9})$/.test(String(identity.revision??'')))return false;
   // This is the server's recorded account-label shape, not simulator proof.
   // Opaque physical IDs never select a backend; the caller's trusted gate does.
   if(typeof route.senderLabel!=='string'||!(new RegExp('^'+channel+' · '+(channel==='email'?'(?:gmail|imap|outlook)':channel)+' · [^\\r\\n]{1,300}$')).test(route.senderLabel))return false;
   const account=bindingId+':'+bindingDigest,prior=accounts.get(channel);
   if(prior&&prior!==account)return false;
   accounts.set(channel,account);channels.add(channel);bindingIds.add(bindingId);recipients.add(channel+':'+String(recipient.value));if(channel!=='whatsapp')routeLead=lead;
  }
  const channelSet=[...channels].sort().join(',');
  if(routeLead&&leads.has(routeLead)||expectedChannels!==undefined&&expectedChannels!==channelSet)return false;
  expectedChannels=channelSet;if(routeLead)leads.add(routeLead);return true;
 });
}
export function eligibleSimulatedAutoApprovalBatches(batches:AgentReviewBatchView[],selection:AgentDemoAutoApprovalSelection,editedBatchId?:string|null):AgentReviewBatchView[]{
 return batches.filter(batch=>{
  if(!exactPendingBatch(batch,editedBatchId))return false;
  const categories=batch.operations.map(op=>category(op.name));
  // Mixed action families remain individually reviewable, even with All selected.
  if(new Set(categories).size!==1)return false;
  return batch.operations.every((op,index)=>{const key=categories[index];if(!key||selection[key]!==true||op.input.requiresHumanReview!==undefined&&typeof op.input.requiresHumanReview!=='boolean'||op.input.requiresHumanReview===true&&['initialMessages','replies','followUps'].includes(key)&&selection.reviewFlaggedDrafts!==true)return false;return key==='contacts'?simulatedContactPlan(op.input):simulatedMessage(op);});
 });
}
