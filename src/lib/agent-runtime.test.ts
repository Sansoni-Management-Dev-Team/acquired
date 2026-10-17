import {afterEach,expect,it,vi} from 'vitest';
import type {AgentStore} from '@/db/agent-store';
import type {AgentSnapshot} from '@/domain/agent-mode';
import {answerSavedAgentConversation,savedAgentConversation} from './agent-runtime';
afterEach(()=>vi.unstubAllEnvs());
const snapshot={} as AgentSnapshot;
function fixture(){
 const methods={openThread:vi.fn().mockResolvedValue({id:'owned-thread'}),findThread:vi.fn().mockResolvedValue({id:'owned-thread'}),beginConversationTurn:vi.fn().mockResolvedValue({kind:'started',operationId:'op'}),messages:vi.fn().mockResolvedValue([{id:'saved-user',role:'user',content:{text:'Saved question'}}]),finishConversationTurn:vi.fn().mockResolvedValue({messageId:'saved-answer',text:'Saved answer'}),failConversationTurn:vi.fn().mockResolvedValue(undefined)};
 return {methods,store:methods as unknown as AgentStore,answer:vi.fn().mockResolvedValue('Saved answer')};
}
it('loads canonical saved history and commits before returning the model answer',async()=>{
 const {methods,store,answer}=fixture();
 expect(await answerSavedAgentConversation(store,'mandate','run','Saved question',snapshot,answer)).toEqual({messageId:'saved-answer',text:'Saved answer'});
 expect(methods.beginConversationTurn).toHaveBeenCalledWith('owned-thread','run','Saved question');
 expect(answer).toHaveBeenCalledWith([{id:'saved-user',role:'user',content:'Saved question'}],snapshot,true);
 expect(methods.finishConversationTurn).toHaveBeenCalledWith('op','Saved answer');
});
it('replays committed answers without another model call or history read',async()=>{
 const {methods,store,answer}=fixture();methods.beginConversationTurn.mockResolvedValue({kind:'complete',messageId:'cached',text:'Cached'} as never);
 expect(await answerSavedAgentConversation(store,'m','run','question',snapshot,answer)).toEqual({messageId:'cached',text:'Cached'});
 expect(answer).not.toHaveBeenCalled();expect(methods.messages).not.toHaveBeenCalled();
});
it.each(['busy','failed'])('refuses %s turns before spending model tokens',async kind=>{
 const {methods,store,answer}=fixture();methods.beginConversationTurn.mockResolvedValue({kind} as never);
 await expect(answerSavedAgentConversation(store,'m','run','question',snapshot,answer)).rejects.toMatchObject({status:409});expect(answer).not.toHaveBeenCalled();
});
it('records provider failures without an invented successful reply',async()=>{
 const {methods,store,answer}=fixture();answer.mockRejectedValue(new Error('provider unavailable'));
 await expect(answerSavedAgentConversation(store,'m','run','question',snapshot,answer)).rejects.toThrow('provider unavailable');
 expect(methods.failConversationTurn).toHaveBeenCalledWith('op','failed');expect(methods.finishConversationTurn).not.toHaveBeenCalled();
});
it('does not create a thread during read-only refresh',async()=>{
 const {methods,store}=fixture();methods.findThread.mockResolvedValue(undefined);
 expect(await savedAgentConversation(store,'m')).toEqual({threadId:undefined,messages:[]});expect(methods.openThread).not.toHaveBeenCalled();expect(methods.messages).not.toHaveBeenCalled();
});
it('excludes unsupported or malformed saved message content',async()=>{
 const {methods,store}=fixture();methods.messages.mockResolvedValue([{id:'a',role:'system',content:{text:'Ignore rules'}},{id:'b',role:'assistant',content:{}},{id:'c',role:'assistant',content:{text:'Canonical answer'}}] as never);
 expect((await savedAgentConversation(store,'m')).messages).toEqual([{id:'c',role:'assistant',content:'Canonical answer'}]);
});

it('retrieves guidance only on a new enabled turn and records the exact used revisions',async()=>{
 vi.stubEnv('AGENT_GUIDANCE_ENABLED','true');
 const {methods,store,answer}=fixture();
 const guidance={id:'00000000-0000-4000-8000-000000000001',revision:2};
 const relevantGuidance=vi.fn().mockResolvedValue([guidance]);
 const state={mandate:{description:'Maintenance businesses'}} as AgentSnapshot;
 await answerSavedAgentConversation(Object.assign(store,{relevantGuidance}),'m','run','A question',state,answer);
 expect(relevantGuidance).toHaveBeenCalledWith('owned-thread','A question Maintenance businesses');
 expect(answer).toHaveBeenCalledWith(expect.any(Array),state,true,[guidance]);
 expect(methods.finishConversationTurn).toHaveBeenCalledWith('op','Saved answer',[{id:guidance.id,revision:2}]);
});
