import {expect,it} from 'vitest';
import {plainAgentStatusText} from './agent-chat-status-copy';
const operation='00000000-0000-4000-8000-000000000001',conversation='00000000-0000-4000-8000-000000000002',review='00000000-0000-4000-8000-000000000003';
const row=(text:string,request_key='provider-outcome:'+operation+':2',details:Record<string,unknown>={operationId:operation,conversationId:conversation,channel:'email',status:'submitted'})=>({role:'assistant',request_key,content:{text,details}});
it.each(['email','whatsapp','linkedin']as const)('explains confirmed %s submission without claiming delivery',channel=>{
 const text=`The original ${channel} message submission was confirmed. All recorded channel histories must be checked before another action.`,message=plainAgentStatusText(row(text,undefined,{operationId:operation,conversationId:conversation,channel,status:'submitted'}));
 expect(message).toBe(channel==='email'?'Your email is on its way. I’ll watch for their reply.':`Your ${channel==='whatsapp'?'WhatsApp':'LinkedIn'} message is on its way. I’ll watch for their reply.`);expect(message).not.toMatch(/delivered|read|received/i);
});
it.each(['email','whatsapp','linkedin']as const)('keeps an uncertain %s outcome explicitly paused without suggesting a retry',channel=>{
 const text=`The original ${channel} outcome is uncertain. Automation remains held and its budget reserved; no new send was attempted.`,message=plainAgentStatusText(row(text,undefined,{operationId:operation,conversationId:conversation,channel,status:'unknown'}));
 expect(message).toBe(`I couldn’t confirm whether your ${channel==='email'?'email':channel==='whatsapp'?'WhatsApp message':'LinkedIn message'} was sent. I’ve paused sending while this is checked.`);expect(message).not.toMatch(/resend|retry|delivered/i);
});
it('supports historical email submission wording without modifying saved receipts',()=>{
 const submitted=row('The communications service confirmed the original email submission. I will verify the updated conversation history before further work.',undefined,{operationId:operation,conversationId:conversation,status:'submitted'}),original=JSON.stringify(submitted);
 expect(plainAgentStatusText(submitted)).toBe('Your email is on its way. I’ll watch for their reply.');expect(JSON.stringify(submitted)).toBe(original);
 expect(plainAgentStatusText(row('The original provider outcome is uncertain. Automation is held and its send budget remains reserved; no new send was attempted.',undefined,{operationId:operation,conversationId:conversation,status:'unknown'}))).toContain('I couldn’t confirm whether your email was sent.');
});
it('explains the specifically cleared transport hold while retaining approval for the next message',()=>{
 const text='The original submission is reconciled and its complete history is verified. The transport-only hold is cleared; future messages still require their own approval.';
 expect(plainAgentStatusText(row(text,'provider-history-resumed:'+conversation+':3',{conversationId:conversation,reason:'provider_receipt_pending_history'}))).toBe('The message has been checked. This sending issue is resolved. The next message still needs your approval.');
});
it.each(['email','whatsapp','linkedin']as const)('uses correct channel naming for %s draft notices without saying sent',channel=>{
 const text=`I prepared a ${channel} message for your review. It has not been sent.`,details={operationId:operation,conversationId:conversation,reviewBatchId:review,channel};
 expect(plainAgentStatusText(row(text,'draft-notice:'+operation,details))).toBe(`Your ${channel==='email'?'email':channel==='whatsapp'?'WhatsApp':'LinkedIn'} draft is ready to review. It hasn’t been sent.`);
 if(channel==='email')expect(plainAgentStatusText(row('I prepared an email for your review. It has not been sent.','draft-notice:'+operation,{operationId:operation,conversationId:conversation,reviewBatchId:review}))).toBe('Your email draft is ready to review. It hasn’t been sent.');
});
it.each(['user','model_quote','wrong_operation','wrong_status','wrong_channel','bad_key','changed_text']as const)('preserves raw text for %s rather than rewriting free prose',kind=>{
 const text='The original email message submission was confirmed. All recorded channel histories must be checked before another action.',saved=row(text);
 if(kind==='user')saved.role='user';if(kind==='model_quote')saved.request_key='turn:'+operation+':assistant';if(kind==='wrong_operation')saved.content.details.operationId=review;if(kind==='wrong_status')saved.content.details.status='unknown';if(kind==='wrong_channel')saved.content.details.channel='whatsapp';if(kind==='bad_key')saved.request_key='provider-outcome:invalid:2';if(kind==='changed_text')saved.content.text+=' Read this first.';
 expect(plainAgentStatusText(saved)).toBe(saved.content.text);
});
it('never rewrites a cleared hold or draft under mismatched provenance and ignores malformed content',()=>{
 const hold='The original submission is reconciled and its complete history is verified. The transport-only hold is cleared; future messages still require their own approval.';
 expect(plainAgentStatusText(row(hold,'provider-history-resumed:'+operation+':3',{conversationId:conversation,reason:'provider_receipt_pending_history'}))).toBe(hold);
 const draft='I prepared a email message for your review. It has not been sent.';expect(plainAgentStatusText(row(draft,'draft-notice:'+operation,{operationId:operation}))).toBe(draft);
 expect(plainAgentStatusText({role:'assistant',content:{text:'Other status'}})).toBe('Other status');expect(plainAgentStatusText(null)).toBeUndefined();expect(plainAgentStatusText({content:{text:{unsafe:'object'}}})).toBeUndefined();
});
it('uses only the bounded trusted server-joined lead name in rewritten system notices',()=>{
 const text='The original email message submission was confirmed. All recorded channel histories must be checked before another action.',saved={...row(text),lead_name:' Saishabi  Sharma '};
 expect(plainAgentStatusText(saved)).toBe('Your email to Saishabi Sharma is on its way. I’ll watch for their reply.');
 const draftRow={...row('I prepared a linkedin message for your review. It has not been sent.','draft-notice:'+operation,{operationId:operation,conversationId:conversation,reviewBatchId:review,channel:'linkedin'}),lead_name:'Saishabi Sharma'};
 expect(plainAgentStatusText(draftRow)).toBe('Your LinkedIn draft for Saishabi Sharma is ready to review. It hasn’t been sent.');
 for(const lead_name of ['', ' ', 'x'.repeat(201), {name:'Guessed'}, 'Invalid\u0000Name'])expect(plainAgentStatusText({...saved,lead_name})).toBe('Your email is on its way. I’ll watch for their reply.');
 expect(plainAgentStatusText({...saved,request_key:'turn:answer:assistant'})).toBe(text);expect(plainAgentStatusText({...row(text),content:{text,details:{...saved.content.details,lead_name:'Guessed from details'}}})).toBe('Your email is on its way. I’ll watch for their reply.');
});

it('simplifies only genuine saved review acknowledgements, not a typed user message',()=>{
 const text='You approved the displayed proposals. Execution will recheck current permissions and conversation state.',saved={role:'user',request_key:'review:'+review+':approved',content:{text,reviewBatchId:review,decision:'approved'}};
 expect(plainAgentStatusText(saved)).toBe('You approved these items. I’ll check that everything is ready before continuing.');expect(plainAgentStatusText({...saved,request_key:'user:typed'})).toBe(text);
});

it('explains confirmed non-submission as paused work, retaining the explicit human resume step',()=>{
 const text='The original channel message was confirmed not submitted. Its sending reservations were released. Automation remains held; review and explicitly resume before proposing fresh outreach.',saved={role:'assistant',request_key:'no-submission:'+operation,lead_name:'Saishabi Sharma',content:{text,operationId:operation}};
 expect(plainAgentStatusText(saved)).toBe('Your message to Saishabi Sharma wasn’t sent. Sending is paused. Review this conversation before resuming.');
 expect(plainAgentStatusText({...saved,lead_name:undefined})).toBe('Your message wasn’t sent. Sending is paused. Review this conversation before resuming.');
 expect(plainAgentStatusText({...saved,content:{text,operationId:review}})).toBe(text);expect(plainAgentStatusText({...saved,request_key:'turn:'+operation+':assistant'})).toBe(text);
});
it('makes the saved internal reminder clear without suggesting it sends a message',()=>{
 const text='I will reassess this conversation at the saved time. This reminder does not approve an email.',saved={...row(text,'reminder-notice:'+operation,{conversationId:conversation,wakeAt:'2026-10-20T10:00:00Z'}),lead_name:'Saishabi Sharma'};
 expect(plainAgentStatusText(saved)).toBe('I’ll review the conversation with Saishabi Sharma at the scheduled time. Any new message still needs your approval.');
 expect(plainAgentStatusText({...saved,lead_name:undefined})).toBe('I’ll review this conversation at the scheduled time. Any new message still needs your approval.');
 expect(plainAgentStatusText({...saved,request_key:'turn:answer:assistant'})).toBe(text);expect(plainAgentStatusText({...saved,content:{text,details:{conversationId:'invalid',wakeAt:'2026-10-20T10:00:00Z'}}})).toBe(text);
});
it('describes the submitted LinkedIn invitation without claiming acceptance or delivery',()=>{
 const text='The reviewed LinkedIn invitation was submitted. Acceptance is not confirmed; I will check the recorded relationship later.',saved={...row(text,'invitation-outcome:'+operation,{operationId:operation,conversationId:conversation,routeId:review,status:'submitted',effect:'invitation'}),lead_name:'Saishabi Sharma'};
 expect(plainAgentStatusText(saved)).toBe('Your LinkedIn invitation to Saishabi Sharma is on its way. I’m waiting for confirmation that it’s been accepted.');
 expect(plainAgentStatusText({...saved,lead_name:undefined})).toBe('Your LinkedIn invitation is on its way. I’m waiting for confirmation that it’s been accepted.');
 expect(plainAgentStatusText({...saved,content:{text,details:{...saved.content.details,status:'unknown'}}})).toBe(text);expect(plainAgentStatusText({...saved,content:{text,details:{...saved.content.details,operationId:review}}})).toBe(text);expect(plainAgentStatusText({...saved,request_key:'turn:'+operation+':assistant'})).toBe(text);
});

it.each([
 ['human-review','I need your help before continuing this conversation. Automation is held; no message was sent.'],
 ['stop','This conversation is stopped. No further automated follow-up will be sent.'],
 ['review-history','You requested fresh history from every recorded account. Automation remains held for your separate reassessment decision; old drafts and sending permissions were invalidated.'],
 ['review-reassess','You reviewed the current complete history and requested a fresh assessment. Any new message requires new approval; no previous send or approval was retried.'],
 ['held-history','A fresh recorded-account history check was requested. Automation remains held.'],
 ['held-resumed','You resumed this reconciled conversation with fresh verified history. Previous approvals and delegated permissions remain revoked; any new draft needs fresh authority.'],
 ['ownership-begin','Conversation handover is pending. New automated sends are fenced while the previous driver and any uncertain sends are reconciled.'],
 ['ownership-commit','You now own this conversation. Automated prospect messages are paused.'],
 ['ownership-commit','Conversation ownership changed after reconciliation. Existing sequence versions and retired callbacks remain fenced.'],
 ['sequence-adopt','The original sequence account and published version are recorded. Its runtime still owns the conversation until an explicit reconciled handover.'],
 ['handoff-notice','This lead is ready to discuss a call. Please review the conversation and send the booking link. Automated follow-ups are paused.'],
 ['local-delivery','The approved email was delivered to the local test sink. No provider email was sent.'],
]as const)('names the person in the exact saved %s conversation status only', (prefix,text)=>{
 const saved={...row(text,prefix+':'+operation,{conversationId:conversation,taskId:review}),lead_name:'Saishabi Sharma'};
 const displayed=plainAgentStatusText(saved);expect(displayed).toContain('Saishabi Sharma');expect(displayed).not.toBe(text);expect(plainAgentStatusText({...saved,request_key:'turn:'+operation+':assistant'})).toBe(text);expect(plainAgentStatusText({...saved,role:'user'})).toBe(text);expect(plainAgentStatusText({...saved,content:{...saved.content,text:text+' Extra prose.'}})).toBe(text+' Extra prose.');
});
it.each([
 ['A verified reply arrived. Cold outreach across all channels is cancelled while I check the full conversation.',false,true],
 ['A verified reply arrived on a stopped conversation. Cold outreach across all channels is cancelled; automation remains stopped.',false,true],
 ['A verified reply arrived for this person. Cold outreach across all channels is cancelled; your existing control remains in place.',false,true],
 ['An incoming channel event needs identity review. No verified reply or cold cancellation was inferred. Automation remains paused.',true,false],
]as const)('names the owned conversation for a channel event without falsely verifying review-only messages', (text,reviewRequired,verifiedReply)=>{
 const saved={...row(text,'channel-incoming:'+'a'.repeat(64),{conversationId:conversation,routeId:review,channel:'whatsapp',bindingId:operation,serviceEventId:'event',reviewRequired,verifiedReply}),lead_name:'Saishabi Sharma'};
 expect(plainAgentStatusText(saved)).toContain('Saishabi Sharma');expect(plainAgentStatusText({...saved,request_key:'turn:answer:assistant'})).toBe(text);expect(plainAgentStatusText({...saved,content:{text,details:{...saved.content.details,verifiedReply:!verifiedReply}}})).toBe(text);
 if(reviewRequired)expect(plainAgentStatusText(saved)).toContain('I haven’t confirmed it as their reply');else expect(plainAgentStatusText(saved)).toMatch(/follow-ups/i);
});
it.each([
 ['opt-out:'+conversation+':3','The lead asked not to be contacted. This conversation is stopped and no reply was drafted.'],
 ['history-conflict:'+conversation+':3','Conversation history could not be verified. Automation is held for human review.'],
 ['route-history-conflict:'+review+':3','A recorded channel history could not be verified. Automation is held for human review.'],
 ['delivery-failure:'+conversation,'The email provider reported a delivery failure. Outreach to this address is stopped. Review the recipient and original account; no follow-up or replacement send was created.'],
]as const)('names the lead in a confirmed saved stop, failure or history hold: %s',(key,text)=>{
 const saved={...row(text,key,{conversationId:conversation,routeId:review,channel:'email'}),lead_name:'Saishabi Sharma'};expect(plainAgentStatusText(saved)).toContain('Saishabi Sharma');expect(plainAgentStatusText({...saved,request_key:'turn:answer:assistant'})).toBe(text);
});
it.each([
 ['acknowledged','The human handoff was acknowledged.'],
 ['pending','The human handoff was reassigned.'],
 ['acknowledged','An internal human-task reminder was saved. Automation remains paused.'],
 ['dismissed','The human handoff was dismissed. Automation remains paused.'],
 ['link_sent','A human recorded sending the booking link externally. This does not confirm a meeting. Automation remains paused.'],
 ['meeting_confirmed','A human recorded a confirmed meeting with external evidence. Automation remains paused.'],
]as const)('names the booking follow-up without inferring a sent link or meeting: %s',(status,text)=>{
 const saved={...row(text,'handoff-notice:'+operation,{id:review,revision:2,status}),lead_name:'Saishabi Sharma'};
 expect(plainAgentStatusText(saved)).toContain('Saishabi Sharma');expect(plainAgentStatusText({...saved,request_key:'turn:answer:assistant'})).toBe(text);expect(plainAgentStatusText({...saved,content:{text,details:{...saved.content.details,id:'invalid'}}})).toBe(text);
 if(status==='link_sent')expect(plainAgentStatusText(saved)).toContain('A meeting isn’t confirmed yet');
});
it.each([
 ['A new email needs human review. Automation remains paused.',true],
 ['A new email arrived on a stopped conversation. Automation remains stopped.',false],
 ['A new email arrived for a conversation you are handling. Automation remains paused.',false],
 ['A new email arrived. I am checking the full conversation before deciding what to do next.',false],
]as const)('names legacy incoming email notices only for their exact owned conversation', (text,reviewRequired)=>{
 const saved={...row(text,'incoming-email:'+'b'.repeat(64)+':'+conversation,{conversationId:conversation,reviewRequired}),lead_name:'Saishabi Sharma'};expect(plainAgentStatusText(saved)).toContain('Saishabi Sharma');expect(plainAgentStatusText({...saved,content:{text,details:{...saved.content.details,conversationId:operation}}})).toBe(text);
});
it('names reminders, uncertain invitations, and older no-submission receipts without mutating or fabricating outcomes',()=>{
 const text='Human handoff reminder: Review the requested call time. Automation remains paused. No message was sent to the lead.',saved={...row(text,'task-reminder:'+operation,{taskId:review,taskRevision:2}),lead_name:'Saishabi Sharma'};expect(plainAgentStatusText(saved)).toBe('Reminder for Saishabi Sharma: Review the requested call time. Automatic messages remain paused; no message was sent.');expect(plainAgentStatusText({...saved,request_key:'turn:answer:assistant'})).toBe(text);
 const unknown='The original invitation outcome is unknown. Automation is held without resending.';expect(plainAgentStatusText({...row(unknown,'invitation-outcome:'+operation,{operationId:operation,conversationId:conversation,routeId:review,status:'unknown'}),lead_name:'Saishabi Sharma'})).toContain('LinkedIn invitation to Saishabi Sharma was sent. Sending is paused');
 for(const source of ['email','LinkedIn invitation']){const original=`The original ${source} was confirmed not submitted. Its sending reservations were released. Automation remains held; review and explicitly resume before proposing fresh outreach.`,r={role:'assistant',request_key:'no-submission:'+operation,lead_name:'Saishabi Sharma',content:{text:original,operationId:operation}};expect(plainAgentStatusText(r)).toContain('Saishabi Sharma wasn’t sent');expect(r.content.text).toBe(original);}
});
it('labels lead-scoped system review reasons without rewriting their model prose or ordinary chat answers',()=>{
 const text='The available public buyer profile does not establish the required acquisition criteria.',saved={role:'assistant',request_key:'event-review:'+operation+':2',lead_name:'Saishabi Sharma',content:{text,triggerEventId:operation,runId:review}};
 expect(plainAgentStatusText(saved)).toBe('Saishabi Sharma: '+text);expect(saved.content.text).toBe(text);expect(plainAgentStatusText({...saved,request_key:'turn:'+operation+':assistant'})).toBe(text);expect(plainAgentStatusText({...saved,role:'user'})).toBe(text);expect(plainAgentStatusText({...saved,content:{...saved.content,triggerEventId:conversation}})).toBe(text);expect(plainAgentStatusText({...saved,lead_name:undefined})).toBe(text);
});

it('explains a controlled channel-reference failure in plain language for the named lead only',()=>{
 const saved={role:'assistant',request_key:'event-review:'+operation+':2',lead_name:'Rahul Sunail',content:{text:'A draft requires its exact recorded channel route',triggerEventId:operation,runId:review}};
 expect(plainAgentStatusText(saved)).toBe('I couldn’t match the draft to Rahul Sunail’s saved contact details. I’ve paused this conversation for a check.');
 expect(plainAgentStatusText({...saved,request_key:'turn:'+operation+':assistant'})).toBe(saved.content.text);expect(saved.content.text).toBe('A draft requires its exact recorded channel route');
});
