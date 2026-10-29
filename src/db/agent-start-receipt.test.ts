import {expect,it,vi} from 'vitest';
import type {PoolClient} from 'pg';
vi.mock('server-only',()=>({}));
import {AgentTargetStore} from './agent-target-store';
import {agentRecordDigest as digest} from './agent-store';
const id='11111111-1111-4111-8111-111111111111',mandate='22222222-2222-4222-8222-222222222222';
const input={mode:'channels',policyRevision:2},result={id,revision:1,status:'proposed'};
const saved={name:'target.selection_plan',state:'complete',input,input_digest:digest({name:'target.selection_plan',input}),result};
function fixture(row:unknown){
 const store=new AgentTargetStore({} as never,{organizationId:'org',userId:'owner'}),query=vi.fn().mockResolvedValue({rows:row?[row]:[]});
 const internal=store as unknown as {transaction:<T>(fn:(c:PoolClient)=>Promise<T>,preset?:unknown,readOnly?:boolean)=>Promise<T>};
 const transaction=vi.spyOn(internal,'transaction').mockImplementation(fn=>fn({query}as unknown as PoolClient));
 return{store,query,transaction};
}
it('reads only exact owned historical completion in a read-only transaction without rebinding to a later workflow',async()=>{
 const f=fixture(saved);expect(await f.store.completedOutreachStart(id,mandate,'original-key')).toEqual(result);
 expect(f.transaction).toHaveBeenCalledWith(expect.any(Function),undefined,true);
 expect(f.query).toHaveBeenCalledOnce();const [sql,args]=f.query.mock.calls[0];
 expect(args).toEqual([id,mandate,'org','owner','control:'+digest('original-key')]);
 for(const clause of ['t.mandate_id=$2','t.organization_id=$3','t.owner_user_id=$4','o.mandate_id=t.mandate_id','o.organization_id=t.organization_id','o.owner_user_id=t.owner_user_id','o.request_key=$5'])expect(sql).toContain(clause);
 expect(sql).not.toMatch(/FOR UPDATE|set_config|ORDER BY|acquisition_workflow/);
});
it('does not bypass new-key Start checks when no owned receipt exists',async()=>{expect(await fixture(null).store.completedOutreachStart(id,mandate,'new-key')).toBeNull();});
it.each([{state:'running'},{state:'failed'},{name:'control.start'},{input_digest:'tampered'},{input:{mode:'local_sink'}},{result:{status:'proposed'}}])('rejects incomplete or mismatched receipt %j',async patch=>{await expect(fixture({...saved,...patch}).store.completedOutreachStart(id,mandate,'key')).rejects.toThrow();});
