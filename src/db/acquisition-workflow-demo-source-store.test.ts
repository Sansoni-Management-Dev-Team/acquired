import {expect,it,vi} from 'vitest';
import {AcquisitionWorkflowStore} from './acquisition-workflow-store';
import {agentRecordDigest} from '@/lib/agent-record-digest';
vi.mock('server-only',()=>({}));
const m=vi.hoisted(()=>({select:vi.fn()}));vi.mock('@/lib/workflow-demo-source',()=>({selectWorkflowDemoSource:m.select}));
const actor={organizationId:'synthetic-org',userId:'synthetic-owner'},id='10000000-0000-4000-8000-000000000001',source='10000000-0000-4000-8000-000000000002',other='10000000-0000-4000-8000-000000000003',input={requestId:id,preset:'demo'as const,presentation:'agent'as const};
const row={id,mandate_id:source,organization_id:actor.organizationId,owner_user_id:actor.userId,preset:'demo',presentation:'agent',state:'accepted',revision:1,error_code:null};
const receipt=(mandateId=source)=>({organization_id:actor.organizationId,actor_id:actor.userId,action:'workflow.demo_source_selected',entity_type:'acquisition_workflow',entity_id:id,metadata:{inputDigest:agentRecordDigest(input),mandateId,mandateRevision:'7'}});
function fixture(options:{existing?:typeof row;receipt?:ReturnType<typeof receipt>;race?:boolean;failure?:boolean;none?:boolean}={}){
 m.select.mockReset().mockResolvedValue(options.none?undefined:{mandateId:source,mandateRevision:'7'});let reads=0;
 const query=vi.fn(async(sql:string)=>{
  if(sql.includes('workflow-demo-existing')){reads++;return{rows:options.existing?[options.existing]:options.race&&reads>1?[{...row,mandate_id:other}]:[],rowCount:0};}
  if(sql.includes('workflow-demo-source-receipt'))return{rows:options.receipt?[options.receipt]:options.race&&reads>1?[receipt(other)]:[],rowCount:0};
  if(sql.includes('FROM member'))return{rows:[{id:'member'}],rowCount:1};
  if(sql.includes('acquisition_workflow_start')){if(options.failure)throw Object.assign(Error('Saved source changed'),{code:'40001'});return{rows:[options.race?{...row,mandate_id:other}:row],rowCount:1};}
  if(sql==='SELECT id FROM acquisition_workflow_executions WHERE id=$1')return{rows:options.existing||options.race?[{id}]:[],rowCount:0};
  return{rows:[],rowCount:0};
 });const release=vi.fn();return{query,release,store:new AcquisitionWorkflowStore({connect:async()=>({query,release})}as never,actor)};
}
it('chooses before the global fence then atomically records the server source before guarded SQL admission',async()=>{
 const f=fixture();await expect(f.store.start(input)).resolves.toMatchObject({mandateId:source,replayed:false});expect(m.select).toHaveBeenCalledOnce();expect(f.query).toHaveBeenCalledWith('SELECT * FROM public.acquisition_workflow_start($1,$2,$3,$4,$5)',[id,'demo','agent',source,'7']);
 const audit=f.query.mock.calls.findIndex(([sql])=>sql.startsWith('INSERT INTO audit_events')),gate=f.query.mock.calls.findIndex(([sql])=>sql.includes('communications_lock_send_gate')),start=f.query.mock.calls.findIndex(([sql])=>sql.includes('acquisition_workflow_start'));
 expect(gate).toBeGreaterThan(-1);expect(audit).toBeGreaterThan(gate);expect(start).toBeGreaterThan(audit);expect(f.query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
});
it('replays the original selected source and original revision without choosing again',async()=>{
 const f=fixture({existing:row,receipt:receipt()});await expect(f.store.start(input)).resolves.toMatchObject({replayed:true});expect(m.select).not.toHaveBeenCalled();expect(f.query).toHaveBeenCalledWith('SELECT * FROM public.acquisition_workflow_start($1,$2,$3,$4,$5)',[id,'demo','agent',source,'7']);expect(f.query.mock.calls.some(([sql])=>sql.startsWith('INSERT INTO audit_events'))).toBe(false);
});
it('keeps pre-existing workflow requests without a source receipt on their original null-argument digest',async()=>{
 const f=fixture({existing:row});await expect(f.store.start(input)).resolves.toMatchObject({replayed:true});expect(m.select).not.toHaveBeenCalled();expect(f.query).toHaveBeenCalledWith('SELECT * FROM public.acquisition_workflow_start($1,$2,$3,$4,$5)',[id,'demo','agent',null,null]);
});
it('rechecks a concurrent same-request winner and preserves its source instead of overwriting the receipt',async()=>{
 const f=fixture({race:true});await expect(f.store.start(input)).resolves.toMatchObject({mandateId:other,replayed:true});expect(m.select).toHaveBeenCalledOnce();expect(f.query).toHaveBeenCalledWith('SELECT * FROM public.acquisition_workflow_start($1,$2,$3,$4,$5)',[id,'demo','agent',other,'7']);expect(f.query.mock.calls.some(([sql])=>sql.startsWith('INSERT INTO audit_events'))).toBe(false);
});
it('rejects foreign requests and changed receipt inputs without selecting or admitting different work',async()=>{
 for(const options of [{existing:{...row,owner_user_id:'foreign'}},{existing:row,receipt:{...receipt(),actor_id:'foreign'}},{existing:row,receipt:{...receipt(),metadata:{...receipt().metadata,inputDigest:'f'.repeat(64)}}}]){const f=fixture(options);await expect(f.store.start(input)).rejects.toMatchObject({code:'23505'});expect(m.select).not.toHaveBeenCalled();expect(f.query.mock.calls.some(([sql])=>sql.includes('acquisition_workflow_start')||sql.startsWith('INSERT'))).toBe(false);}
});
it('rolls back a stale source once, preserving the kernel CAS and never retrying or switching it after admission',async()=>{
 const f=fixture({failure:true});await expect(f.store.start(input)).rejects.toMatchObject({code:'40001'});expect(m.select).toHaveBeenCalledOnce();expect(f.query.mock.calls.filter(([sql])=>sql.includes('acquisition_workflow_start'))).toHaveLength(1);expect(f.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');expect(f.release).toHaveBeenCalledOnce();
});
it('reports unavailable saved data without creating a receipt, workflow, conversation or fallback live request',async()=>{
 const f=fixture({none:true});await expect(f.store.start(input)).rejects.toMatchObject({code:'02000'});expect(f.query.mock.calls.some(([sql])=>sql.includes('acquisition_workflow_start')||sql.startsWith('INSERT'))).toBe(false);
});

it('replays a concurrent winner even when it consumed the final available source during the hint read',async()=>{
 const f=fixture({race:true,none:true});await expect(f.store.start(input)).resolves.toMatchObject({mandateId:other,replayed:true});expect(f.query.mock.calls.some(([sql])=>sql.startsWith('INSERT INTO audit_events'))).toBe(false);
});
