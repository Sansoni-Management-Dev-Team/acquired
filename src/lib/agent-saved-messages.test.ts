import {expect,it} from 'vitest';
import {savedAgentMessages} from './agent-saved-messages';
import {groupAgentChatNotices} from '@/components/agent-chat-notices';
const text='You reviewed a person’s exact channel and account. Provider identity and full history must still be verified before outreach.';
const id='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
it('marks the saved admission welcome without hiding it or trusting an ordinary model/user greeting',()=>{
 const row={id:'welcome',role:'assistant',request_key:`initial-welcome:v1:${id}`,content:{text:'Hi, I’m Acquire.\n\nOriginal saved brief.',details:{executionId:id}}};
 expect(savedAgentMessages([row])[0]).toMatchObject({id:'welcome',noticeKind:'welcome',content:row.content.text});
 expect(groupAgentChatNotices(savedAgentMessages([row]))).toEqual([{kind:'message',message:expect.objectContaining({noticeKind:'welcome'})}]);
 for(const invalid of [{...row,role:'user'},{...row,request_key:'turn:assistant'},{...row,content:{...row.content,details:{executionId:other}}}])expect(savedAgentMessages([invalid])[0]).not.toHaveProperty('noticeKind');
});
function notice(){return {id:'message',role:'assistant',request_key:'channel-route:'+id,content:{text,details:{conversationId:other,routeId:id,channel:'whatsapp',bindingId:other,policyRevision:1,recipient:'PRIVATE_ROUTE',bindingDigest:'PRIVATE_BINDING'}}};}
it('marks only the saved exact channel-route notice while never exposing internal provenance or route details',()=>{
 const rows=[notice()];expect(savedAgentMessages(rows)).toEqual([{id:'message',role:'assistant',content:text,noticeKind:'contact_channel_reviewed'}]);expect(JSON.stringify(savedAgentMessages(rows))).not.toMatch(/PRIVATE|request_key|details|bindingId|routeId/);
});
it.each(['model','user','different_route','missing_details','bad_route','bad_conversation','bad_binding','unknown_channel','zero_policy','string_policy','changed_text']as const)('does not assign a system notice marker for %s provenance',kind=>{
 const row=notice();if(kind==='model')row.request_key='turn:'+id+':assistant';if(kind==='user')row.role='user';if(kind==='different_route')row.request_key='channel-route:'+other;if(kind==='missing_details')Object.assign(row.content,{details:null});if(kind==='bad_route')row.content.details.routeId='invalid';if(kind==='bad_conversation')row.content.details.conversationId='invalid';if(kind==='bad_binding')row.content.details.bindingId='invalid';if(kind==='unknown_channel')row.content.details.channel='sms';if(kind==='zero_policy')row.content.details.policyRevision=0;if(kind==='string_policy')Object.assign(row.content.details,{policyRevision:'1'});if(kind==='changed_text')row.content.text+=' Extra text.';
 const messages=savedAgentMessages([row]);expect(messages).toHaveLength(1);expect(messages[0]).not.toHaveProperty('noticeKind');expect(messages[0].content).toBe(row.content.text);
});
it('keeps ordinary user and model text unchanged in saved order and ignores unsupported records',()=>{
 const rows=[{id:'one',role:'user',content:{text:'Hello'}},{id:'two',role:'assistant',content:{text:'Hello'}},null,{id:'three',role:'system',content:{text:'Internal'}},{id:'four',role:'assistant',content:{text:2}}];
 expect(savedAgentMessages(rows)).toEqual([{id:'one',role:'user',content:'Hello'},{id:'two',role:'assistant',content:'Hello'}]);
});
it('keeps trusted notices grouped while naming each saved lead, without exposing the name join or source details',()=>{
 const rows=[{...notice(),lead_name:'Saishabi Sharma'},{...notice(),id:'second',lead_name:'Akilas Fernandez'}],messages=savedAgentMessages(rows),grouped=groupAgentChatNotices(messages);
 expect(messages[0].content).toContain('Saishabi Sharma');expect(messages[1].content).toContain('Akilas Fernandez');expect(grouped).toEqual([{kind:'channel_notices',messages}]);expect(JSON.stringify(messages)).not.toMatch(/lead_name|request_key|details|PRIVATE/);expect(rows[0].content.text).toBe(text);
});
it('displays named saved replies and holds while preserving original receipts, IDs and chronology',()=>{
 const reply='A verified reply arrived. Cold outreach across all channels is cancelled while I check the full conversation.',hold='I need your help before continuing this conversation. Automation is held; no message was sent.',rows=[{id:'reply',role:'assistant',lead_name:'Saishabi Sharma',request_key:'channel-incoming:'+'a'.repeat(64),content:{text:reply,details:{conversationId:id,routeId:id,bindingId:id,channel:'email',serviceEventId:'event',reviewRequired:false,verifiedReply:true}}},{id:'hold',role:'assistant',lead_name:'Akilas Fernandez',request_key:'human-review:'+id,content:{text:hold,details:{conversationId:other}}}];const original=JSON.stringify(rows),messages=savedAgentMessages(rows);
 expect(messages.map(message=>message.id)).toEqual(['reply','hold']);expect(messages[0].content).toContain('Saishabi Sharma replied');expect(messages[1].content).toContain('Akilas Fernandez');expect(JSON.stringify(messages)).not.toMatch(/lead_name|request_key|details|serviceEventId/);expect(JSON.stringify(rows)).toBe(original);
});

it('adds a bounded named lead update and reply preview from the scoped server join only',()=>{
 const row={id:'reply',role:'assistant',lead_name:'Zoe Allison',lead_conversation_id:id,lead_company:'Vet Lab',lead_reply:{text:'Can you explain the buyer?',channel:'email',at:'2026-10-21T03:09:00Z'},request_key:'channel-incoming:'+'a'.repeat(64),content:{text:'A verified reply arrived. Cold outreach across all channels is cancelled while I check the full conversation.',details:{conversationId:id,routeId:other,bindingId:other,channel:'email',serviceEventId:'event',reviewRequired:false,verifiedReply:true}}};
 expect(savedAgentMessages([row])[0]).toMatchObject({noticeKind:'lead_update',lead:{id,name:'Zoe Allison',company:'Vet Lab',kind:'reply',reply:{text:'Can you explain the buyer?',channel:'email'}}});
 expect(savedAgentMessages([{...row,request_key:'turn:'+id+':assistant'}])[0]).not.toHaveProperty('lead');
});

it('marks only trusted routine startup records for the welcome screen while retaining user and model messages',()=>{
 const text='This mandate is registered for background work. Budget limits do not approve messages; outreach still requires its current review and exact account.';
 const row={id:'startup',role:'assistant',request_key:'runtime-registration:'+id+':1',content:{text,details:{responsibilityId:id,responsibilityRevision:1}}};
 expect(savedAgentMessages([row])[0].noticeKind).toBe('setup_activity');expect(savedAgentMessages([{...row,request_key:'turn:model'}])[0].noticeKind).toBeUndefined();expect(savedAgentMessages([{...row,role:'user'}])[0].noticeKind).toBeUndefined();expect(row.content.text).toBe(text);
});
it('folds trusted demo preparation into activity rather than repeating backend setup in chat',()=>{
 const row={id:'prep',role:'assistant',request_key:'demo-contacts:'+id,content:{text:'Prepared 50 simulated contacts for this demo. The company and person research stays real. This preparation does not approve or send messages.',details:{requestKey:id,demoRunId:other,count:50}}};
 expect(savedAgentMessages([row])[0].noticeKind).toBe('routine_activity');expect(savedAgentMessages([{...row,request_key:'turn:assistant'}])[0].noticeKind).toBeUndefined();
});

function emptySelection(messageId:string,requestId=id){return {id:messageId,role:'assistant',request_key:'target-empty:'+requestId,content:{text:'No cached contacts are currently eligible for a new conversation. Review missing contact data, mandate fit, prior outreach or ownership holds.',details:{counts:{contacts:220,companies:8,reviewed:2,selected:0,excluded:2},excluded:[{contactId:id,reasons:['excluded_by_mandate_review']},{contactId:other,reasons:['demo_mapping_required','excluded_by_mandate_review']}]}}};}
it('reports the saved fit exclusion once without deleting history or exposing contact IDs',()=>{
 const rows=[emptySelection('first'),emptySelection('second',other)],before=JSON.stringify(rows),messages=savedAgentMessages(rows);
 expect(messages).toHaveLength(1);expect(messages[0].content).toBe('None of the 2 contacts checked match this mandate’s requirements. I haven’t started outreach. Review the company matches or try another demo.');
 expect(JSON.stringify(messages)).not.toMatch(/excluded_by|demo_mapping|00000000/);expect(JSON.stringify(rows)).toBe(before);
});
it('preserves repeated user/model text, changed results and a new attempt after a user action',()=>{
 const a=emptySelection('first'),b=emptySelection('second',other),user={id:'user',role:'user',content:{text:'Check again'}};
 expect(savedAgentMessages([a,user,b])).toHaveLength(3);
 const changed=emptySelection('changed',other);changed.content.details.excluded[0].reasons=['suppressed'];expect(savedAgentMessages([a,changed])).toHaveLength(2);
 expect(savedAgentMessages([{...a,request_key:'turn:model'},{...b,request_key:'turn:another'}])).toHaveLength(2);
 expect(savedAgentMessages([{...a,role:'user'},{...b,role:'user'}])).toHaveLength(2);
 const malformed={...a,content:{...a.content,details:{}}};expect(savedAgentMessages([malformed])[0].content).toBe(a.content.text);
});
it('exposes only durable event-review correlation IDs, never guessed failure certainty',()=>{
 const row={id:'failure',role:'assistant',request_key:`event-review:${id}:2`,content:{text:'Background work was interrupted.',triggerEventId:id,runId:other,stage:'PRIVATE_STAGE',operationId:'PRIVATE_OPERATION'},lead:{id,name:'Example'}};
 expect(savedAgentMessages([row])[0]).toHaveProperty('failure',{eventId:id,runId:other});
 for(const invalid of [{...row,role:'user'},{...row,request_key:`event-review:${other}:2`},{...row,content:{...row.content,runId:'bad'}},{...row,request_key:'turn:'+id}])expect(savedAgentMessages([invalid])[0]).not.toHaveProperty('failure');
 expect(JSON.stringify(savedAgentMessages([row]))).not.toContain('PRIVATE');
});
