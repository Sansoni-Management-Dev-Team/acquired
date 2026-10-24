import {expect,it,vi} from 'vitest';
import {AgentStore} from './agent-store';
vi.mock('server-only',()=>({}));
const id='00000000-0000-4000-8000-000000000001';
function fixture(allowed=true,found=true){
 const record={operation:{id,name:'email.initial',state:'complete'},conversation:{id,history:[]},route:{id,channel:'email'}};
 const query=vi.fn(async(sql:string)=>{
  if(/FOR UPDATE|FOR SHARE|agent_lock|agent_context_revision|agent_channel_proposal_permitted|INSERT|UPDATE|DELETE/.test(sql))throw Error('Display must not enter admission or locks');
  return {rows:sql.includes('current_user')?[{name:'acquire_agent_user',rolsuper:false,rolbypassrls:false}]:sql.includes('AS allowed')?[{allowed}]:sql.includes('FROM agent_operations o')?(found?[record]:[]):[],rowCount:1};
 });const release=vi.fn();return{record,query,release,store:new AgentStore({connect:async()=>({query,release})}as never,{organizationId:'org',userId:'owner'})};
}
it('projects saved operation without authority checks or mutation gates in one consistent readonly transaction',async()=>{
 const f=fixture();expect(await f.store.operationDisplayRecord(id,id)).toEqual(f.record);
 expect(f.query).toHaveBeenCalledWith('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const call=f.query.mock.calls.find(([sql])=>sql.includes('FROM agent_operations o'))!;
 expect(call[0]).toContain('t.organization_id=$3 AND t.owner_user_id=$4');expect(call[0]).toContain('o.owner_user_id=t.owner_user_id');expect(call[0]).toContain('c.owner_user_id=t.owner_user_id');expect(call[0]).toContain('r.owner_user_id=t.owner_user_id');
 expect(f.query).toHaveBeenCalledWith(call[0],[id,id,'org','owner']);expect(f.query).toHaveBeenCalledWith('COMMIT');expect(f.release).toHaveBeenCalledOnce();
});
it('denies revoked membership before reading saved operations',async()=>{const f=fixture(false);await expect(f.store.operationDisplayRecord(id,id)).rejects.toThrow('no longer a member');expect(f.query.mock.calls.some(([sql])=>sql.includes('FROM agent_operations'))).toBe(false);});
it('fails closed for foreign or missing operation/thread scope',async()=>{const f=fixture(true,false);await expect(f.store.operationDisplayRecord(id,id)).rejects.toThrow('Owned operation display unavailable');expect(f.query).toHaveBeenCalledWith('ROLLBACK');});
