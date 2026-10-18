import {expect,it} from 'vitest';
import {canonicalAgentPersonKeys,beginAgentHandover,commitAgentHandover,ownsAgentExecution} from './agent-ownership';
const id='00000000-0000-4000-8000-000000000001';
const agent={kind:'agent' as const,responsibilityId:id};
const sequence={kind:'sequence' as const,enrolmentId:id,runtime:'n8n' as const,generation:1};
const owner={driver:sequence,epoch:1,revision:1,status:'active' as const,contextRevision:'history-1'};
it('normalises shared person identities so duplicate contacts can share one owner',()=>{
 expect(canonicalAgentPersonKeys({contactId:id,email:' OWNER@Example.Invalid ',firmablePersonId:'person-1'})).toEqual(['contact:'+id,'email:owner@example.invalid','firmable:person-1']);
});
it('quiesces and fences the old driver before a new one can execute',()=>{
 const pending=beginAgentHandover(owner,agent,{epoch:1,revision:1,contextRevision:'history-1'});
 expect(pending.status).toBe('quiescing');expect(pending.epoch).toBe(2);
 expect(ownsAgentExecution(pending,sequence,1)).toBe(false);expect(ownsAgentExecution(pending,agent,2)).toBe(false);
});
it('refuses to complete handover with an unknown or in-flight send',()=>{
 const pending=beginAgentHandover(owner,agent,{epoch:1,revision:1,contextRevision:'history-1'});
 for(const changes of [{unknownSends:1},{inFlightSends:1},{previousDriverQuiesced:false}])expect(()=>commitAgentHandover(pending,2,{unknownSends:0,inFlightSends:0,previousDriverQuiesced:true,...changes})).toThrow();
});
it('rejects stale callbacks after a transfer out and back, even to the same enrolment',()=>{
 const pending=beginAgentHandover(owner,agent,{epoch:1,revision:1,contextRevision:'history-1'});
 const current=commitAgentHandover(pending,2,{unknownSends:0,inFlightSends:0,previousDriverQuiesced:true});
 expect(ownsAgentExecution(current,agent,current.epoch)).toBe(true);expect(ownsAgentExecution(current,sequence,1)).toBe(false);
 expect(()=>beginAgentHandover(current,sequence,{epoch:current.epoch,revision:current.revision,contextRevision:'history-1'})).toThrow('fresh');
 const freshSequence={...sequence,enrolmentId:'00000000-0000-4000-8000-000000000002'};
 const back=beginAgentHandover(current,freshSequence,{epoch:current.epoch,revision:current.revision,contextRevision:'history-1'});
 const restored=commitAgentHandover(back,back.epoch,{unknownSends:0,inFlightSends:0,previousDriverQuiesced:true});
 expect(ownsAgentExecution(restored,sequence,1)).toBe(false);expect(ownsAgentExecution(restored,sequence,restored.epoch)).toBe(false);expect(ownsAgentExecution(restored,freshSequence,restored.epoch)).toBe(true);
});
it('does not transfer authority from a stale mandate/history view or admit paused automation',()=>{
 for(const changes of [{epoch:2},{revision:2},{contextRevision:'history-2'}])expect(()=>beginAgentHandover(owner,agent,{epoch:1,revision:1,contextRevision:'history-1',...changes})).toThrow('changed');
 expect(ownsAgentExecution({...owner,status:'paused'},sequence,1)).toBe(false);
});
it('human ownership never authorises automated execution',()=>{
 const human={kind:'human' as const,userId:'human'};
 const pending=beginAgentHandover(owner,human,{epoch:1,revision:1,contextRevision:'history-1'}),current=commitAgentHandover(pending,pending.epoch,{unknownSends:0,inFlightSends:0,previousDriverQuiesced:true});
 expect(ownsAgentExecution(current,agent,current.epoch)).toBe(false);expect(ownsAgentExecution(current,human,current.epoch)).toBe(false);
});
