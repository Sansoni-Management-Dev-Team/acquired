import {afterEach,expect,it,vi} from 'vitest';
import type {PoolClient} from 'pg';
vi.mock('server-only',()=>({}));
import {AgentTargetStore} from './agent-target-store';
import {emptyBrief} from '@/domain/acquisition';
const ids={thread:'11111111-1111-4111-8111-111111111111',contact:'22222222-2222-4222-8222-222222222222',old:'33333333-3333-4333-8333-333333333333',next:'44444444-4444-4444-8444-444444444444',batch:'55555555-5555-4555-8555-555555555555'};
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
function fixture(state:string,reviewState:string){
 vi.stubEnv('AGENT_LOCAL_SIMULATION_ENABLED','true');
 const prior=Object.freeze({id:ids.old,revision:1,state,batch_id:'original-batch',result:Object.freeze({allocated:0,needsReview:1}),reviewState});
 const store=new AgentTargetStore({}as never,{organizationId:'fixture-org',userId:'fixture-user'});
 const query=vi.fn(async(sql:string)=>{
  if(sql.startsWith('SELECT o.id')){
   const bounded=sql.includes("o.state IN('proposed','approved','running')")&&sql.includes("b.state IN('pending','approved')");
   return{rows:!bounded||(['proposed','approved','running'].includes(state)&&['pending','approved'].includes(reviewState))?[prior]:[]};
  }
  if(sql.startsWith('INSERT INTO agent_operations'))return{rows:[{id:ids.next,revision:1}]};
  if(sql.startsWith('INSERT INTO agent_review_batches'))return{rows:[{id:ids.batch}]};
  return{rows:[]};
 });
 const internal=store as unknown as{command:(thread:string,key:string,name:string,input:unknown,work:(c:PoolClient,t:unknown,key:string)=>Promise<unknown>)=>Promise<unknown>;targetContext:()=>Promise<unknown>;controlNotice:()=>Promise<void>;emit:()=>Promise<void>};
 vi.spyOn(internal,'command').mockImplementation((_thread,_key,_name,_input,work)=>work({query}as unknown as PoolClient,{id:ids.thread,mandate_id:'mandate'},'command'));
 vi.spyOn(internal,'targetContext').mockResolvedValue({mandateRevision:'1',responsibilityId:'responsibility',responsibilityRevision:1,brief:emptyBrief(),companies:0,contacts:1,candidates:[{contactId:ids.contact,targetId:null,sourceKind:'manual_contact',name:'Saved contact',email:'contact@example.invalid',sourceRevision:'a'.repeat(64),target:null,findings:[],blockedReasons:[]}]});
 vi.spyOn(internal,'controlNotice').mockResolvedValue();vi.spyOn(internal,'emit').mockResolvedValue();
 const allocate=vi.spyOn(store,'allocateApprovedTargets');return{store,query,prior,allocate};
}
it.each([['complete','approved'],['rejected','rejected'],['failed','invalidated'],['proposed','invalidated']])('allows an explicit fresh proposal after %s/%s while preserving the original receipt',async(state,reviewState)=>{
 const f=fixture(state,reviewState),original=JSON.stringify(f.prior);
 expect(f.query).not.toHaveBeenCalled();
 const proposal=await f.store.proposeTargetSelection(ids.thread,'new-human-request',{mode:'local_sink'});
 expect(proposal).toMatchObject({id:ids.next,status:'proposed',reviewBatchId:ids.batch});
 expect(f.allocate).not.toHaveBeenCalled();expect(JSON.stringify(f.prior)).toBe(original);
 expect(f.query.mock.calls.some(([sql])=>/^UPDATE agent_(operations|review_batches)/.test(sql))).toBe(false);
});
it.each([['proposed','pending'],['approved','approved'],['running','approved']])('reuses the exact live %s/%s proposal without allocation or a duplicate review',async(state,reviewState)=>{
 const f=fixture(state,reviewState),proposal=await f.store.proposeTargetSelection(ids.thread,'explicit-request',{mode:'local_sink'});
 expect(proposal).toMatchObject({id:ids.old,status:state,reviewBatchId:'original-batch'});
 expect(f.query.mock.calls.some(([sql])=>sql.startsWith('INSERT'))).toBe(false);expect(f.allocate).not.toHaveBeenCalled();
});

it('uses one notice identity for repeated unchanged empty selections and changes it for fresh source facts',async()=>{
 const f=fixture('complete','approved');
 const internal=f.store as unknown as {command:(thread:string,key:string,name:string,input:unknown,work:(c:PoolClient,t:unknown,key:string)=>Promise<unknown>)=>Promise<unknown>;targetContext:()=>Promise<unknown>;controlNotice:()=>Promise<void>};
 const context={mandateRevision:'1',responsibilityId:ids.old,responsibilityRevision:1,brief:emptyBrief(),companies:0,contacts:1,candidates:[{contactId:ids.contact,targetId:null,sourceKind:'manual_contact',name:'Saved contact',email:'contact@example.invalid',sourceRevision:'a'.repeat(64),target:null,findings:[],blockedReasons:['suppressed']}]};
 vi.mocked(internal.targetContext).mockResolvedValue(context);
 vi.mocked(internal.command).mockImplementation((_thread,key,_name,_input,work)=>work({query:f.query}as unknown as PoolClient,{id:ids.thread,mandate_id:'mandate'},key));
 const before=JSON.stringify(context);
 await f.store.proposeTargetSelection(ids.thread,ids.old,{mode:'local_sink'});await f.store.proposeTargetSelection(ids.thread,ids.next,{mode:'local_sink'});
 const notices=vi.mocked(internal.controlNotice).mock.calls as unknown as unknown[][];
 expect(notices[0][2]).toMatch(/^target-empty:[a-f0-9]{64}$/);expect(notices[1][2]).toBe(notices[0][2]);expect(JSON.stringify(context)).toBe(before);expect(f.allocate).not.toHaveBeenCalled();
 context.candidates[0].sourceRevision='b'.repeat(64);await f.store.proposeTargetSelection(ids.thread,ids.batch,{mode:'local_sink'});expect(notices[2][2]).not.toBe(notices[0][2]);
 expect(f.query.mock.calls.some(([sql])=>/^(UPDATE|INSERT|DELETE)/.test(sql))).toBe(false);
});
