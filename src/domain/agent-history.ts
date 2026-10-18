import {nativeHistorySchema,nativeReminderSchema,explicitAgentOptOut,type NativeHistory} from './agent-execution';
/** Only a trusted provider adapter or the explicit local sink may call this.
 * The model never supplies authoritative history or its completeness flag. */
export function acceptAgentHistory(previous:NativeHistory|undefined,raw:unknown,mode:'local_sink'|'communications',now:string):NativeHistory{
 const next=nativeHistorySchema.parse(raw),instant=Date.parse(now),observed=Date.parse(next.observedAt);
 if(!Number.isFinite(instant)||observed>instant)throw new Error('History observation is in the future');
 if((mode==='local_sink')!==(next.source==='local_fixture'))throw new Error('History provenance differs from the immutable delivery mode');
 if(previous&&observed<Date.parse(previous.observedAt))throw new Error('History snapshot is older than the saved snapshot');
 const current=new Map(next.messages.map(m=>[m.id,m]));
 for(const old of previous?.messages??[]){
  const item=current.get(old.id);if(!item)throw new Error('Earlier history is missing; request a full history before continuing');
  if(item.text!==old.text||item.direction!==old.direction||Date.parse(item.at)!==Date.parse(old.at)||(item.subject??'')!==(old.subject??'')||item.routeId!==old.routeId||item.channel!==old.channel||item.providerMessageId!==old.providerMessageId||item.providerConversationId!==old.providerConversationId||item.bindingDigest!==old.bindingDigest)throw new Error('Previously observed history changed; human review required');
 }
 if(next.messages.some(m=>Date.parse(m.at)>observed))throw new Error('Message is newer than its history observation');
 return {...next,messages:[...next.messages].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)||(a.id<b.id?-1:a.id>b.id?1:0))};
}
export function validateAgentWakeup(raw:unknown,now:string){
 const input=nativeReminderSchema.parse(raw),instant=Date.parse(now),wake=Date.parse(input.wakeAt);
 if(!Number.isFinite(instant)||wake<=instant)throw new Error('Wake-up must be in the future');
 if(wake-instant>366*24*60*60*1000)throw new Error('Wake-up must be within 366 days');
 return input;
}
/** Preserve terminal/manual conversation state when a new provider snapshot
 * arrives; observing a reply is not authority to resume automation. */
export function nextAgentEngagement(current:'cold'|'engaged'|'handoff'|'stopped',history:NativeHistory['messages']){
 if(history.some(m=>m.direction==='inbound'&&explicitAgentOptOut(m.text)))return 'stopped';
 if(current==='handoff'||current==='stopped')return current;
 return history.some(m=>m.direction==='inbound')?'engaged':current;
}
