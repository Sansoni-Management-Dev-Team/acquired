import {afterEach,expect,it,vi} from 'vitest';
import type {PoolClient} from 'pg';
vi.mock('server-only',()=>({}));
import {AgentExecutionStore} from './agent-execution-store';
const thread='11111111-1111-4111-8111-111111111111';
afterEach(()=>vi.restoreAllMocks());
function fixture(operation?:{state:string;result?:unknown}){
 const store=new AgentExecutionStore({}as never,{organizationId:'fixture-org',userId:'fixture-user'});
 const query=vi.fn<(sql:string)=>Promise<{rows:Record<string,unknown>[]}>>(async(sql:string)=>({rows:sql.startsWith('SELECT xmin')?[{revision:'1',execution_mode:'real'}]:sql.includes("name='target.select'")?(operation?[operation]:[]):[]}));
 const internal=store as unknown as{nativeTransaction:<T>(fn:(c:PoolClient)=>Promise<T>)=>Promise<T>;thread:()=>Promise<unknown>};
 vi.spyOn(internal,'nativeTransaction').mockImplementation(fn=>fn({query}as unknown as PoolClient));
 vi.spyOn(internal,'thread').mockResolvedValue({id:thread,mandate_id:'mandate',organization_id:'fixture-org'});
 return{store,query};
}
it.each([['approved','queued'],['running','running'],['complete','needs_review']])('projects latest %s contact allocation read-only as %s',async(state,expected)=>{
 const f=fixture({state,result:{allocated:2,needsReview:1}}),view=await f.store.executionState(thread);
 expect(view).toMatchObject({contactAllocation:{state:expected,allocated:2,needsReview:1}});
 const reads=f.query.mock.calls.map(([sql])=>sql);
 expect(reads.every(sql=>sql.startsWith('SELECT'))).toBe(true);
 expect(reads.find(sql=>sql.includes("name='target.select'"))).toMatch(/ORDER BY created_at DESC,id DESC LIMIT 1/);
});
it.each([undefined,{state:'complete',result:{allocated:5,needsReview:0}},{state:'proposed'},{state:'rejected'},{state:'failed'}])('omits terminal success or irrelevant contact allocation state %#',async row=>{
 const f=fixture(row);expect(await f.store.executionState(thread)).not.toHaveProperty('contactAllocation');
});
it('bounds untrusted saved counts without leaking operation inputs or errors',async()=>{
 const f=fixture({state:'approved',result:{allocated:-9,needsReview:'private-token',input:'recipient@example.invalid'}}),view=await f.store.executionState(thread);
 expect(view).toMatchObject({contactAllocation:{state:'queued',allocated:0,needsReview:0}});
 expect(JSON.stringify(view)).not.toMatch(/private-token|recipient@/);
});

it('projects a saved empty selection separately from allocation and does not label the mandate ready',async()=>{
 const f=fixture();f.query.mockImplementation(async(sql:string)=>({rows:sql.startsWith('SELECT xmin')?[{revision:'1',execution_mode:'real'}]:sql.includes('AS selection_empty')?[{selection_empty:true}]:[]}));
 expect(await f.store.executionState(thread)).toMatchObject({contactSelectionEmpty:true});
 const sql=f.query.mock.calls.find(([sql])=>sql.includes('AS selection_empty'))![0];
 expect(sql).toContain("name='target.selection_plan'");expect(sql).toContain("result->>'status'='needs_review'");expect(sql).toContain('agent_responsibilities');expect(sql).toContain('agent_channel_policies');expect(sql).toContain('mandate_revision');expect(sql).toContain('ORDER BY');
 expect(f.query.mock.calls.every(([sql])=>sql.startsWith('SELECT'))).toBe(true);
});
