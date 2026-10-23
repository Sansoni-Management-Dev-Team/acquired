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
