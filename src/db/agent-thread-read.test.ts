import {expect,it,vi} from 'vitest';
import {AgentStore} from './agent-store';
vi.mock('server-only',()=>({}));
const mandate='00000000-0000-4000-8000-000000000001';
function fixture(allowed=true){
 const query=vi.fn(async(sql:string)=>{
  if(sql.includes('agent_lock_send_gate')||sql.includes('agent_lock_member'))throw Error('Mutation gate unavailable');
  return {rows:sql.includes('current_user')?[{name:'acquire_agent_user',rolsuper:false,rolbypassrls:false}]:sql.includes('AS allowed')?[{allowed}]:[],rowCount:0};
 });
 const release=vi.fn();const store=new AgentStore({connect:async()=>({query,release})}as never,{organizationId:'org',userId:'owner'});
 return {query,release,store};
}
it('finds the owned thread without entering the mutation gate',async()=>{
 const f=fixture();expect(await f.store.findThread(mandate)).toBeUndefined();
 expect(f.query).toHaveBeenCalledWith('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 expect(f.query).toHaveBeenCalledWith('SELECT * FROM agent_threads WHERE organization_id=$1 AND mandate_id=$2 AND owner_user_id=$3',['org',mandate,'owner']);
 expect(f.query).toHaveBeenCalledWith('COMMIT');expect(f.release).toHaveBeenCalledOnce();
});
it('still denies revoked membership before reading threads',async()=>{
 const f=fixture(false);await expect(f.store.findThread(mandate)).rejects.toThrow('no longer a member');
 expect(f.query.mock.calls.some(([sql])=>sql.includes('FROM agent_threads'))).toBe(false);
 expect(f.query).toHaveBeenCalledWith('ROLLBACK');expect(f.release).toHaveBeenCalledOnce();
});
