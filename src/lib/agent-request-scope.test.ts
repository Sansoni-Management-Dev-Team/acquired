import {afterEach,expect,it,vi} from 'vitest';
vi.mock('@/lib/auth',()=>({auth:{}}));
vi.mock('@/lib/agent-runtime',()=>({agentStore:vi.fn(),durableAgentEnabled:vi.fn()}));
vi.mock('@/lib/acquire-commands',()=>({acquireCommands:{}}));
import {agentRequestFailure} from './agent-request-scope';
afterEach(()=>vi.restoreAllMocks());
it('records a safe database failure code without logging SQL, credentials or request data',async()=>{
 const log=vi.spyOn(console,'warn').mockImplementation(()=>{});
 const failure=Object.assign(new Error('private SQL and credential'),{code:'55P03',detail:'private recipient'});
 const response=agentRequestFailure(failure);
 expect(log).toHaveBeenCalledWith('agent-request-failed',{errorName:'Error',databaseCode:'55P03'});
 expect(response.status).toBe(409);
 expect(await response.text()).not.toContain('private');
 expect(JSON.stringify(log.mock.calls)).not.toContain('private');
});
it.each([
 ['Conversation changed; review its current state first','conversation_context_changed'],
 ['Only an active agent conversation or a human-review agent hold can be reviewed','conversation_not_reviewable'],
 ['Review and start the current mandate responsibility first','responsibility_not_current'],
 ['Finish the current person or mandate background work before reviewing','background_work_active'],
 ['Resolve current unknown outcomes, ownership, suppression or channel review before reassessment','review_blocked'],
 ['Refresh complete recorded history before requesting reassessment','history_not_current'],
])('classifies exact known review guard without exposing its text: %s',async(message,category)=>{
 const log=vi.spyOn(console,'warn').mockImplementation(()=>{});const response=agentRequestFailure(new Error(message));
 expect(log).toHaveBeenCalledWith('agent-request-failed',{errorName:'Error',reviewFailure:category});
 expect(response.status).toBe(409);expect(await response.text()).not.toContain(message);
});
it('does not infer a review guard from arbitrary partial exception text',()=>{
 const log=vi.spyOn(console,'warn').mockImplementation(()=>{});
 agentRequestFailure(new Error('private recipient: Conversation changed; review its current state first'));
 expect(log).toHaveBeenCalledWith('agent-request-failed',{errorName:'Error'});
});
