import {expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {AgentChannelStore} from './agent-channel-store';
const thread='10000000-0000-4000-8000-000000000001',route='10000000-0000-4000-8000-000000000002';
function fixture(installed=true,rows:unknown[]=[{exempt:true}]){
 const query=vi.fn(async(sql:string,values?:unknown[])=>{void values;return sql.includes('to_regprocedure')?{rows:[{installed}]}:{rows};});
 const store=new AgentChannelStore({connect:vi.fn()} as never,{organizationId:'owned-org',userId:'owned-user'});
 const internal=store as unknown as Record<string,(...args:unknown[])=>Promise<unknown>>;
 vi.spyOn(internal,'nativeTransaction').mockImplementation(async(work)=>(work as (c:unknown)=>Promise<unknown>)({query}));
 vi.spyOn(internal,'thread').mockResolvedValue({id:thread});return{store,query};
}
it('reads only the exact owned thread route exemption through the installed database guard',async()=>{
 const f=fixture();expect(await f.store.testingSendWindowExempt(thread,route)).toBe(true);
 const [sql,values]=f.query.mock.calls[1];expect(sql).toContain('public.agent_gui_testing_send_window_exempt(r.id)');
 expect(sql).toContain('r.thread_id=$1');expect(sql).toContain('r.organization_id=$3');expect(sql).toContain('r.owner_user_id=$4');
 expect(values).toEqual([thread,route,'owned-org','owned-user']);expect(sql).not.toMatch(/INSERT|UPDATE|DELETE/);
});
it('keeps ordinary send windows when the migration is absent, the route is foreign or the proof is not exactly true',async()=>{
 const missing=fixture(false);expect(await missing.store.testingSendWindowExempt(thread,route)).toBe(false);expect(missing.query).toHaveBeenCalledOnce();
 for(const rows of [[],[{exempt:false}],[{exempt:'true'}],[{exempt:true},{exempt:true}]])expect(await fixture(true,rows).store.testingSendWindowExempt(thread,route)).toBe(false);
});
it('does not conceal database errors or accept malformed route identity',async()=>{
 const f=fixture(),cause=Error('Proof unavailable');f.query.mockRejectedValueOnce(cause);
 await expect(f.store.testingSendWindowExempt(thread,route)).rejects.toBe(cause);
 const malformed=fixture();await expect(malformed.store.testingSendWindowExempt(thread,'not-a-route-id')).rejects.toThrow();expect(malformed.query).not.toHaveBeenCalled();
});
