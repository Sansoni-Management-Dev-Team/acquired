import{randomUUID}from'node:crypto';
export type TimingFixtureEffects={always:boolean;receipts:number;intents:number;journals:number;physicalOutbounds:number;nativeReservations:number};
/** Preserve evidence when the fresh fixture may have accepted an effect. */
export function preserveTimingFixture(effects:TimingFixtureEffects){return effects.always||effects.receipts>0||effects.intents>0||effects.journals>0||effects.physicalOutbounds>0||effects.nativeReservations>0;}
export type TimingChannel='email'|'whatsapp'|'linkedin';
export type TimingSourcePerson={id:string;email:string;phone:string;linkedin:string;providerId:string};
export type TimingSourceAccount={id:string;channel:TimingChannel;owner:string;providerOwnerId:string};
export type TimingSourceState={runId:string;now:string;accounts:TimingSourceAccount[];leads:TimingSourcePerson[]};
export type TimingInboundMessage={id:string;accountId:string;channel:TimingChannel;leadId:string;recipient:string;direction:'inbound';text:string;subject:string;at:string;threadId:string;rfcMessageId:string;parentRfcId:null;headers:never[];trackingId:null};
export type TimingInboundWebhook={id:string;messageId:string;payload:Record<string,unknown>;status:'pending';attempts:0;nextAt:string};
/** Source data for a fresh owned fake provider, not an application/service receipt.
 * The actual raw HTTP ingress must authenticate and independently fetch this
 * message/chat before creating any receipt, normalized event or native outcome.
 * No app sender is needed: real providers can receive unsolicited messages. */
export function timingInboundSource(state:TimingSourceState,input:unknown):{message:TimingInboundMessage;webhook:TimingInboundWebhook}{
 const invalid=():never=>{throw Error('Invalid owned timing source');};
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.getPrototypeOf(input)!==Object.prototype)return invalid();
 const descriptors=Object.getOwnPropertyDescriptors(input);if(Reflect.ownKeys(descriptors).sort().join(',')!=='channel,leadId,text'||Object.values(descriptors).some(d=>!('value'in d)))return invalid();
 const {channel,leadId,text}=input as {channel:unknown;leadId:unknown;text:unknown};
 if(!['email','whatsapp','linkedin'].includes(String(channel))||typeof leadId!=='string'||typeof text!=='string'||!text.trim()||text.length>8000||text.includes('\0')||!state||!/^agent-deep-[a-z0-9][a-z0-9-]{0,36}$/.test(state.runId)||typeof state.now!=='string'||!Number.isFinite(Date.parse(state.now))||new Date(state.now).toISOString()!==state.now||!Array.isArray(state.leads)||!Array.isArray(state.accounts))return invalid();
 const leads=state.leads.filter(l=>l.id===leadId),accounts=state.accounts.filter(a=>a.channel===channel);if(leads.length!==1||accounts.length!==1)return invalid();const lead=leads[0],account=accounts[0];
 if(!/^lead-\d{3}$/.test(lead.id)||lead.email!==`${lead.id}@${state.runId}.leads.acquire.test`||!/^\+999\d{12}$/.test(lead.phone)||lead.linkedin!==`https://www.linkedin.com/in/sim-${state.runId}-${lead.id}`||lead.providerId!==`ACo_sim_${state.runId}_${lead.id}`||account.id!==`sim-${state.runId}-${channel}`||typeof account.providerOwnerId!=='string'||!account.providerOwnerId)return invalid();
 const selected=channel as TimingChannel,id='sim-message-'+randomUUID(),threadId=`sim-timing-${state.runId}-${channel}-${lead.id}`,message:TimingInboundMessage={id,accountId:account.id,channel:selected,leadId:lead.id,recipient:lead[selected==='email'?'email':selected==='whatsapp'?'phone':'linkedin'],direction:'inbound',text,subject:'Local timing fixture',at:state.now,threadId,rfcMessageId:`<${randomUUID()}@${state.runId}.acquire.test>`,parentRfcId:null,headers:[],trackingId:null};
 const payload=channel==='email'?{event:'mail_received',account_id:account.id,email_id:id,date:state.now,role:'inbox'}:{event:'message_received',account_id:account.id,account_type:selected.toUpperCase(),account_info:{type:selected.toUpperCase(),user_id:account.providerOwnerId,...(selected==='linkedin'?{feature:'classic'}:{})},message_id:id,chat_id:threadId,timestamp:state.now,is_sender:0,sender:{attendee_provider_id:selected==='whatsapp'?lead.phone.slice(1)+'@s.whatsapp.net':lead.providerId}};
 return{message,webhook:{id:'sim-event-'+randomUUID(),messageId:id,payload,status:'pending',attempts:0,nextAt:state.now}};
}
