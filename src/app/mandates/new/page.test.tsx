import {afterEach,expect,it,vi} from 'vitest';
vi.mock('@/components/cached-mandate-pages',()=>({CachedMandateCreate:()=>null}));
const request=vi.hoisted(()=>({connection:vi.fn(async():Promise<void>=>undefined)}));
vi.mock('next/server',()=>({connection:request.connection}));
import NewMandatePage from './page';
import Home from '../../page';
afterEach(()=>vi.unstubAllEnvs());
it.each([
 ['true','true',true],['true','false',false],['false','true',false],['false','false',false],
])('both create entrypoints expose the same native approval workflow with durable=%s native=%s',async(durable,native,enabled)=>{
 vi.stubEnv('AGENT_MODE_EXPLORATION_ENABLED','true');vi.stubEnv('AGENT_DURABLE_STATE_ENABLED',durable);vi.stubEnv('AGENT_NATIVE_EXECUTION_ENABLED',native);
 expect((await Home()).props).toMatchObject({agentModeEnabled:true,nativeAgentEnabled:enabled});
 expect((await NewMandatePage()).props).toMatchObject({agentModeEnabled:true,nativeAgentEnabled:enabled});
});
it('does not expose agent mode from either entrypoint when exploration is disabled',async()=>{
 vi.stubEnv('AGENT_MODE_EXPLORATION_ENABLED','false');vi.stubEnv('AGENT_DURABLE_STATE_ENABLED','true');vi.stubEnv('AGENT_NATIVE_EXECUTION_ENABLED','true');
 expect((await Home()).props.agentModeEnabled).toBe(false);expect((await NewMandatePage()).props.agentModeEnabled).toBe(false);
});
it.each([['home',Home],['new mandate',NewMandatePage]] as const)('reads %s availability after the request boundary',async(_name,page)=>{
 let arrive!:()=>void;
 request.connection.mockClear();request.connection.mockImplementationOnce(()=>new Promise<void>(resolve=>{arrive=resolve;}));
 vi.stubEnv('AGENT_MODE_EXPLORATION_ENABLED','false');const pending=page();
 expect(request.connection).toHaveBeenCalledOnce();
 vi.stubEnv('AGENT_MODE_EXPLORATION_ENABLED','true');arrive();
 expect((await pending).props.agentModeEnabled).toBe(true);
});
