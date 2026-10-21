import {afterEach,expect,it,vi} from 'vitest';
import type {PoolClient} from 'pg';
vi.mock('server-only',()=>({}));
import {AgentTargetStore} from './agent-target-store';
import {agentRecordDigest} from './agent-store';

const ids={thread:'11111111-1111-4111-8111-111111111111',mandate:'22222222-2222-4222-8222-222222222222',operation:'33333333-3333-4333-8333-333333333333',contact:'44444444-4444-4444-8444-444444444444',other:'55555555-5555-4555-8555-555555555555'};
function fixture(cause:unknown){
 const store=new AgentTargetStore({}as never,{organizationId:'fixture-org',userId:'fixture-owner'});
 const plan={delivery:{mode:'channels',policyRevision:1},responsibilityId:'fixture-responsibility',selected:[{contactId:ids.contact,sourceRevision:'a'.repeat(64)},{contactId:ids.other,sourceRevision:'b'.repeat(64)}]};
 const op={id:ids.operation,name:'target.select',state:'approved',input:plan,input_digest:agentRecordDigest({name:'target.select',input:plan})};
 const query=vi.fn(async(sql:string)=>({rows:sql.startsWith('SELECT * FROM agent_operations')?[op]:[]}));
 const internal=store as unknown as {nativeTransaction:<T>(fn:(c:PoolClient)=>Promise<T>)=>Promise<T>;lockThread:()=>Promise<unknown>;assertExecutionFence:()=>Promise<void>;command:(...args:unknown[])=>Promise<unknown>;controlNotice:(...args:unknown[])=>Promise<void>;emit:(...args:unknown[])=>Promise<void>};
 vi.spyOn(internal,'nativeTransaction').mockImplementation(fn=>fn({query}as unknown as PoolClient));
 vi.spyOn(internal,'lockThread').mockResolvedValue({id:ids.thread,mandate_id:ids.mandate,organization_id:'fixture-org',owner_user_id:'fixture-owner'});
 vi.spyOn(internal,'assertExecutionFence').mockResolvedValue();
 const allocation=vi.spyOn(internal,'command').mockRejectedValueOnce(cause).mockResolvedValueOnce({id:'fixture-conversation'});
 vi.spyOn(internal,'controlNotice').mockResolvedValue();vi.spyOn(internal,'emit').mockResolvedValue();
 const log=vi.spyOn(console,'warn').mockImplementation(()=>{});
 return{store,allocation,query,log};
}
afterEach(()=>vi.restoreAllMocks());

it('records a bounded allocation failure category and mandate trace without leaking contact or raw error data, then continues the reviewed batch',async()=>{
 const f=fixture(Object.assign(new Error('private-token recipient@example.invalid'),{code:'40001'}));
 const result=await f.store.allocateApprovedTargets(ids.thread,ids.operation);
 expect(result).toMatchObject({allocated:1,needsReview:1,results:[{contactId:ids.contact,status:'needs_review',failureCategory:'database_busy'},{contactId:ids.other,status:'allocated'}]});
 expect(f.allocation).toHaveBeenCalledTimes(2);
 expect(f.log).toHaveBeenCalledTimes(1);
 const record=JSON.parse(f.log.mock.calls[0][0]as string);
 expect(record).toEqual({module:'agent-target-allocation',stage:'contact_allocation_failed',mandateId:ids.mandate,threadId:ids.thread,operationId:ids.operation,category:'database_busy'});
 expect(JSON.stringify(f.log.mock.calls)).not.toMatch(/private-token|recipient@|44444444|fixture-owner|stack/);
 expect(f.query.mock.calls.some(([sql])=>/agent_operations SET state='complete'/.test(sql))).toBe(true);
});

it.each([['57014','allocation_timeout'],['42501','authorization_changed'],['23505','saved_context_conflict'],['secret-code','allocation_needs_review']])('maps only known SQL code %s and never retries the failed allocation',async(code,category)=>{
 const f=fixture(Object.assign(new Error('never-log-this'),{code}));
 const result=await f.store.allocateApprovedTargets(ids.thread,ids.operation);
 expect(result.results[0]).toMatchObject({status:'needs_review',failureCategory:category});
 expect(JSON.parse(f.log.mock.calls[0][0]as string).category).toBe(category);
 expect(f.allocation.mock.calls.filter(([,key])=>String(key).endsWith(ids.contact))).toHaveLength(1);
});

it('ignores hostile error accessors and keeps diagnostics from changing the allocation outcome',async()=>{
 const cause=Object.defineProperty({},'code',{get(){throw new Error('private getter');}}),f=fixture(cause);
 f.log.mockImplementation(()=>{throw new Error('logging unavailable');});
 const result=await f.store.allocateApprovedTargets(ids.thread,ids.operation);
 expect(result).toMatchObject({allocated:1,needsReview:1,results:[{failureCategory:'allocation_needs_review'},{status:'allocated'}]});
});
