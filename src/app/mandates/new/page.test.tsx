import {afterEach,expect,it,vi} from 'vitest';
vi.mock('@/components/cached-mandate-pages',()=>({CachedMandateCreate:()=>null}));
import NewMandatePage from './page';
import Home from '../../page';
afterEach(()=>vi.unstubAllEnvs());
it.each([
 ['true','true',true],['true','false',false],['false','true',false],['false','false',false],
])('both create entrypoints expose the same native approval workflow with durable=%s native=%s',(durable,native,enabled)=>{
 vi.stubEnv('AGENT_MODE_EXPLORATION_ENABLED','true');vi.stubEnv('AGENT_DURABLE_STATE_ENABLED',durable);vi.stubEnv('AGENT_NATIVE_EXECUTION_ENABLED',native);
 expect(Home().props).toMatchObject({agentModeEnabled:true,nativeAgentEnabled:enabled});
 expect(NewMandatePage().props).toMatchObject({agentModeEnabled:true,nativeAgentEnabled:enabled});
});
it('does not expose agent mode from either entrypoint when exploration is disabled',()=>{
 vi.stubEnv('AGENT_MODE_EXPLORATION_ENABLED','false');vi.stubEnv('AGENT_DURABLE_STATE_ENABLED','true');vi.stubEnv('AGENT_NATIVE_EXECUTION_ENABLED','true');
 expect(Home().props.agentModeEnabled).toBe(false);expect(NewMandatePage().props.agentModeEnabled).toBe(false);
});
