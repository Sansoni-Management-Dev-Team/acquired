import { expect,it } from 'vitest';
import { validateConversationDecision } from './conversation-decision';
const context={now:'2026-10-17T08:00:00Z',historyRevision:'history-4',ownerRevision:3,owner:'agent' as const,historyComplete:true,approvedSourceIds:['buyer-profile-2'],suppressed:false,humanTakeover:false};
const question={intent:'question',action:'reply',rationale:'Answer the buyer question using the approved profile.',reply:'The buyer is an Australian acquisition group.',sourceIds:['buyer-profile-2'],historyRevision:'history-4',ownerRevision:3};
it('supports a contextual answer without a sequence step or n8n workflow',()=>{expect(validateConversationDecision(question,context)).toMatchObject({action:'reply',sourceIds:['buyer-profile-2']});});
it('requires fresh review after a new inbound message or ownership change',()=>{
 expect(()=>validateConversationDecision(question,{...context,historyRevision:'history-5'})).toThrow('context');
 expect(()=>validateConversationDecision(question,{...context,ownerRevision:4})).toThrow('context');
 expect(()=>validateConversationDecision(question,{...context,owner:'sequence'})).toThrow('owner');
});
it('routes meeting interest to human handoff and opt-outs to stop',()=>{
 expect(()=>validateConversationDecision({...question,intent:'meeting_ready'},context)).toThrow('handoff');
 expect(validateConversationDecision({...question,intent:'meeting_ready',action:'handoff',reply:undefined},context)).toMatchObject({action:'handoff'});
 expect(()=>validateConversationDecision({...question,intent:'opt_out'},context)).toThrow('stop');
});
it('will not ground a factual answer in invented sources or incomplete history',()=>{
 expect(()=>validateConversationDecision({...question,sourceIds:['invented']},context)).toThrow('source');
 expect(()=>validateConversationDecision(question,{...context,historyComplete:false})).toThrow('review');
});
it('supports a future reassessment instead of a rigid next message',()=>{
 expect(validateConversationDecision({...question,intent:'not_now',action:'wait',reply:undefined,wakeAt:'2026-10-20T08:00:00Z'},context)).toMatchObject({action:'wait'});
 expect(()=>validateConversationDecision({...question,action:'wait',reply:undefined,wakeAt:'2026-10-16T08:00:00Z'},context)).toThrow('future');
});
it('never returns automated outbound under suppression or human takeover',()=>{
 for(const state of [{suppressed:true},{humanTakeover:true}])expect(()=>validateConversationDecision(question,{...context,...state})).toThrow('outbound');
});
