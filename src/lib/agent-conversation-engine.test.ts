import {expect,it,vi} from 'vitest';
import {reassessAgentConversation,type AgentConversationContext} from './agent-conversation-engine';
const context:AgentConversationContext={conversationId:'10000000-0000-4000-8000-000000000001',epoch:1,reminderGeneration:1,revision:1,contextRevision:'a'.repeat(64),phase:'active',driver:'agent',supervisionActive:true,deliveryMode:'local_sink',historyComplete:true,historyObservedAt:'2026-10-17T08:00:00Z',goal:'Find an Australian refrigeration business and arrange a call',history:[{id:'reply-1',direction:'inbound',text:'Who would be buying?',at:'2026-10-17T07:59:00Z'}],sources:[{id:'buyer-profile',text:'An Australian private investment group.'}],guidance:[]};
function fixture(){return {load:vi.fn().mockResolvedValue(context),decide:vi.fn().mockResolvedValue({action:'draft',draft:{kind:'reply_email',intent:'question',subject:'Re: enquiry',body:'An Australian private investment group.',rationale:'Answer the buyer question',sourceIds:['buyer-profile']}}),commit:vi.fn().mockResolvedValue({status:'proposed'}),now:()=> '2026-10-17T08:01:00Z'};}
it('uses the goal and available conversation to draft an answer without advancing a sequence graph',async()=>{
 const port=fixture();await reassessAgentConversation(port,{conversationId:context.conversationId,epoch:1,reminderGeneration:1,requestKey:'event-1'});
 expect(port.decide).toHaveBeenCalledWith(context);expect(port.commit).toHaveBeenCalledWith(context,expect.objectContaining({action:'draft'}),'event-1');
});
it('does not call the model for a stale reminder, a paused owner or an incomplete history',async()=>{
 for(const changed of [{reminderGeneration:2},{phase:'paused'},{driver:'human'},{historyComplete:false},{supervisionActive:false}]){
  const port=fixture();port.load.mockResolvedValue({...context,...changed});await reassessAgentConversation(port,{conversationId:context.conversationId,epoch:1,reminderGeneration:1,requestKey:'event-1'});expect(port.decide).not.toHaveBeenCalled();
 }
});
it('stops an explicit opt-out before asking the model and never proposes an outbound reply',async()=>{
 const port=fixture();port.load.mockResolvedValue({...context,history:[{...context.history[0],text:'Please remove me from your list.'}]});
 await reassessAgentConversation(port,{conversationId:context.conversationId,epoch:1,reminderGeneration:1,requestKey:'event-1'});expect(port.decide).not.toHaveBeenCalled();expect(port.commit).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({action:'stop'}),'event-1');
});
it('rejects fabricated evidence, booking links and malformed model actions without committing them',async()=>{
 for(const decision of [{action:'draft',draft:{kind:'reply_email',intent:'question',subject:'Hello',body:'Fabricated answer',rationale:'Guess',sourceIds:['invented']}},{action:'draft',draft:{kind:'reply_email',intent:'question',subject:'Hello',body:'Book https://example.invalid/call',rationale:'Book',sourceIds:[]}},{action:'send',approved:true}]){
  const port=fixture();port.decide.mockResolvedValue(decision);await expect(reassessAgentConversation(port,{conversationId:context.conversationId,epoch:1,reminderGeneration:1,requestKey:'event-1'})).rejects.toThrow();expect(port.commit).not.toHaveBeenCalled();
 }
});
it('hands meeting readiness to the human without drafting or claiming a booking',async()=>{
 const port=fixture();port.decide.mockResolvedValue({action:'handoff',reason:'Lead asked to talk',summary:'Asked for a call next week',sourceIds:[]});
 await reassessAgentConversation(port,{conversationId:context.conversationId,epoch:1,reminderGeneration:1,requestKey:'event-1'});expect(port.commit).toHaveBeenCalledWith(context,expect.objectContaining({action:'handoff'}),'event-1');
});
it('requests review before a model call for stale or oversized conversation context',async()=>{
 for(const changed of [{historyObservedAt:'2026-10-17T07:00:00Z'},{goal:'x'.repeat(40000)}]){const port=fixture();port.load.mockResolvedValue({...context,...changed});const result=await reassessAgentConversation(port,{conversationId:context.conversationId,epoch:1,reminderGeneration:1,requestKey:'event-1'});expect(result.kind).toBe('review');expect(port.decide).not.toHaveBeenCalled();}
});

it('honours an explicit opt-out even when the provider history is incomplete',async()=>{
 const port=fixture();port.load.mockResolvedValue({...context,historyComplete:false,history:[{...context.history[0],text:'Stop emailing me'}]});
 await reassessAgentConversation(port,{conversationId:context.conversationId,epoch:1,reminderGeneration:1,requestKey:'opt-out'});
 expect(port.decide).not.toHaveBeenCalled();expect(port.commit).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({action:'stop'}),'opt-out');
});

it('persists a conservative future wait when a valid near-term model wake expires during inference, without rewriting its original response',async()=>{
 const port=fixture(),start='2026-10-17T08:01:00.000Z',end='2026-10-17T08:01:03.000Z',original={action:'wait',reminder:{wakeAt:'2026-10-17T08:01:01.000Z',timeZone:'Australia/Brisbane',reason:'w'.repeat(2000)},sourceIds:[]};
 port.now=vi.fn().mockReturnValueOnce(start).mockReturnValue(end);port.decide.mockResolvedValue(original);
 expect(await reassessAgentConversation(port,{conversationId:context.conversationId,epoch:1,reminderGeneration:1,requestKey:'latency-wait'})).toEqual({kind:'complete'});
 expect(port.decide).toHaveBeenCalledOnce();expect(original.reminder.wakeAt).toBe('2026-10-17T08:01:01.000Z');expect(original.reminder.reason).toHaveLength(2000);expect(port.commit.mock.calls[0][1].reminder.reason.length).toBeLessThanOrEqual(2000);
 expect(port.commit).toHaveBeenCalledWith(context,expect.objectContaining({action:'wait',reminder:expect.objectContaining({wakeAt:'2026-10-17T08:01:33.000Z',timeZone:'Australia/Brisbane',reason:expect.stringContaining('2026-10-17T08:01:01.000Z')})}),'latency-wait');
});
it('keeps normal future waits exact but rejects originally past or overlong model waits',async()=>{
 const start='2026-10-17T08:01:00.000Z';for(const [wakeAt,valid]of[['2026-10-17T08:02:00.000Z',true],['2026-10-17T08:00:59.000Z',false],['2027-10-19T08:01:00.000Z',false]]as const){const port=fixture();port.now=vi.fn().mockReturnValueOnce(start).mockReturnValue('2026-10-17T08:01:03.000Z');const reminder={wakeAt,timeZone:'UTC',reason:'Wait for a reply.'};port.decide.mockResolvedValue({action:'wait',reminder,sourceIds:[]});const run=reassessAgentConversation(port,{conversationId:context.conversationId,epoch:1,reminderGeneration:1,requestKey:'bounded-wait'});if(valid){await run;expect(port.commit).toHaveBeenCalledWith(context,{action:'wait',reminder,sourceIds:[]},'bounded-wait');}else{await expect(run).rejects.toThrow('future reminder window');expect(port.commit).not.toHaveBeenCalled();}}
});
it('floors a still-future but near-commit wake and rejects an unbounded or reversed model clock',async()=>{
 for(const [end,valid]of[['2026-10-17T08:01:03.000Z',true],['2026-10-17T08:01:46.000Z',false],['2026-10-17T08:00:59.000Z',false]]as const){const port=fixture();port.now=vi.fn().mockReturnValueOnce('2026-10-17T08:01:00.000Z').mockReturnValue(end);port.decide.mockResolvedValue({action:'wait',reminder:{wakeAt:'2026-10-17T08:01:04.000Z',timeZone:'UTC',reason:'Wait before reassessment.'},sourceIds:[]});const run=reassessAgentConversation(port,{conversationId:context.conversationId,epoch:1,reminderGeneration:1,requestKey:'commit-margin'});if(valid){await run;expect(port.commit).toHaveBeenCalledWith(context,expect.objectContaining({reminder:expect.objectContaining({wakeAt:'2026-10-17T08:01:33.000Z'})}),'commit-margin');}else{await expect(run).rejects.toThrow('future reminder window');expect(port.commit).not.toHaveBeenCalled();}}
});
