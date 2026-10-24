import{describe,it,expect,vi}from'vitest';
import{approvedDispatchEvent,dispatchRunLimits,runDurationMs,runDurationSql}from'./agent-dispatch-budget';
const id='10000000-0000-4000-8000-000000000001',digest='a'.repeat(64),event={id,thread_id:id,organization_id:'org',mandate_id:id,owner_user_id:'owner',workflow_execution_id:null,kind:'review.approved',payload:{reviewBatchId:id}};
const item={operationId:id,revision:1,digest,contextRevision:'context'};
const row={id,name:'email.initial',state:'approved',revision:1,input_digest:digest,input:{contextRevision:'context'},workflow_execution_id:null,delivery_mode:'communications'};
function client(manifest:unknown=[item],rows:unknown[]=[row]){return{query:vi.fn().mockResolvedValueOnce({rows:[{manifest}]}).mockResolvedValueOnce({rows})};}
describe('saved dispatch-only time policy',()=>{
 it('classifies only exact approved owned message manifests',async()=>{const c=client();expect(await approvedDispatchEvent(c as never,event as never)).toBe(true);expect(c.query.mock.calls[1][1]).toContain('org');});
 it.each(['target.select','conversation.decide','email.reconcile'])('rejects non-dispatch %s',async name=>{expect(await approvedDispatchEvent(client([item],[{...row,name}])as never,event as never)).toBe(false)});
 it.each([{state:'proposed'},{revision:2},{input_digest:'b'.repeat(64)},{input:{contextRevision:'changed'}},{workflow_execution_id:id},{delivery_mode:'local_sink'}])('rejects changed operation %j',async change=>{expect(await approvedDispatchEvent(client([item],[{...row,...change}])as never,event as never)).toBe(false)});
 it('rejects duplicate/missing manifest operations and malformed policy',async()=>{expect(await approvedDispatchEvent(client([item,item])as never,event as never)).toBe(false);expect(await approvedDispatchEvent(client([item],[])as never,event as never)).toBe(false);expect(runDurationMs({...dispatchRunLimits,maxDurationMs:90001})).toBe(45000);expect(runDurationMs({...dispatchRunLimits,kind:'model'})).toBe(45000);expect(runDurationMs(undefined)).toBe(45000);expect(runDurationMs(dispatchRunLimits)).toBe(120000);expect(runDurationSql('r')).toContain('90000');});
 it('does not query for model/reconcile events or accept a payload limit flag',async()=>{const c=client();expect(await approvedDispatchEvent(c as never,{...event,kind:'email.reconcile',payload:{operationId:id,dispatch:true}}as never)).toBe(false);expect(c.query).not.toHaveBeenCalled();});
});
it('rejects mixed approved manifests, missing actors and absent approved batches',async()=>{
 const second={...item,operationId:'20000000-0000-4000-8000-000000000002'};
 expect(await approvedDispatchEvent(client([item,second],[row,{...row,id:second.operationId,name:'target.select'}])as never,event as never)).toBe(false);
 const c=client();expect(await approvedDispatchEvent(c as never,{...event,organization_id:undefined}as never)).toBe(false);expect(c.query).not.toHaveBeenCalled();
 expect(await approvedDispatchEvent({query:vi.fn(async()=>({rows:[]}))}as never,event as never)).toBe(false);
});

it('creates v3 limits while retaining exact v2 saved budgets without reinterpretation',()=>{
 expect(dispatchRunLimits).toEqual({version:3,kind:'reviewed_dispatch',maxToolSteps:32,maxDurationMs:120000,operationLeaseMs:90000,eventLeaseMs:150000});
 const prior={version:2,kind:'reviewed_dispatch',maxToolSteps:32,maxDurationMs:90000,operationLeaseMs:60000,eventLeaseMs:120000};
 expect(runDurationMs(prior)).toBe(90000);
 expect(runDurationMs({...prior,maxDurationMs:120000})).toBe(45000);
 expect(runDurationMs({...dispatchRunLimits,operationLeaseMs:60000})).toBe(45000);
});
