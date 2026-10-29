import {expect,it,vi} from 'vitest';
import {reconcileWorkflowPeopleSnapshots} from './acquisition-workflow-people-snapshots';
const execution={id:'execution',organizationId:'org',ownerUserId:'owner',mandateId:'mandate'} as Parameters<typeof reconcileWorkflowPeopleSnapshots>[2];
function fixture(ids=['run'],runs=[{status:'cancelled',profilesFound:3,profilesSaved:2,profilesFailed:0}]){const query=vi.fn<(text:string,values?:unknown[])=>Promise<{rows:Record<string,unknown>[]}>>(async(text:string)=>({rows:text.startsWith('SELECT config')?[{config:{companyPeopleRunIds:['run']}}]:text.startsWith('SELECT id,config')?[{id:'child',config:{companyPeopleRunIds:ids}}]:text.startsWith('SELECT status')?runs:[]}));const release=vi.fn();return{query,release,pool:{connect:vi.fn(async()=>({query,release}))} as unknown as Parameters<typeof reconcileWorkflowPeopleSnapshots>[0]};}
it('reconciles exact terminal child snapshots from settled original runs without changing job status or evidence',async()=>{const f=fixture();expect(await reconcileWorkflowPeopleSnapshots(f.pool,{organizationId:'org',userId:'owner'},execution)).toBe(1);const update=f.query.mock.calls.find(c=>c[0].startsWith('UPDATE'));expect(update?.[0]).toContain("jsonb_set(config,'{companyPeopleProgress}'");expect(update?.[0]).not.toContain('status=');expect(f.query.mock.calls.find(c=>c[0].startsWith('SELECT id,config'))?.[0]).toContain("status IN('complete','partial','cancelled')");});
it.each(['unknown','missing','active'])('does not clear %s child work',async kind=>{const f=fixture(kind==='unknown'?['other']:['run'],kind==='missing'?[]:[{status:kind==='active'?'queued':'complete',profilesFound:0,profilesSaved:0,profilesFailed:0}]);expect(await reconcileWorkflowPeopleSnapshots(f.pool,{organizationId:'org',userId:'owner'},execution)).toBe(0);expect(f.query.mock.calls.some(c=>c[0].startsWith('UPDATE'))).toBe(false);});

it('rejects a foreign actor before checking out a connection',async()=>{const f=fixture();await expect(reconcileWorkflowPeopleSnapshots(f.pool,{organizationId:'other',userId:'owner'},execution)).rejects.toThrow('Owned workflow');expect(f.pool.connect).not.toHaveBeenCalled();});
it('leaves children untouched when the exact settled ordinary root is unavailable',async()=>{const f=fixture();f.query.mockResolvedValue({rows:[]});expect(await reconcileWorkflowPeopleSnapshots(f.pool,{organizationId:'org',userId:'owner'},execution)).toBe(0);expect(f.query.mock.calls.some(c=>c[0].startsWith('SELECT id,config'))).toBe(false);const root=f.query.mock.calls.find(c=>c[0].startsWith('SELECT config'))?.[0];expect(root).toContain("config->'nativeAgent' IS NULL");expect(root).toContain("->>'settled'='true'");});
it('settles cancelled children only from terminal original run proofs and labels cancellation without changing lifecycle',async()=>{const f=fixture();const original=f.query.getMockImplementation()!;f.query.mockImplementation(async sql=>sql.startsWith('SELECT config')?{rows:[{status:'cancelled',config:{companyPeopleRunIds:['run']}}]}:original(sql));expect(await reconcileWorkflowPeopleSnapshots(f.pool,{organizationId:'org',userId:'owner'},execution)).toBe(1);const update=f.query.mock.calls.find(([sql])=>sql.startsWith('UPDATE'))!;expect(update[0]).not.toContain('status=');expect(update[0]).toContain('jsonb_set');expect(JSON.parse(String(update[1]?.[1]))).toMatchObject({settled:true,settlementReason:'cancelled',cancelled:1,complete:0});expect(f.query.mock.calls.some(([sql])=>sql.includes("status NOT IN('complete','partial','failed','cancelled')"))).toBe(true);});
it('does not settle cancelled snapshots while any original research job remains active',async()=>{const f=fixture();const original=f.query.getMockImplementation()!;f.query.mockImplementation(async sql=>sql.startsWith('SELECT config')?{rows:[{status:'cancelled',config:{companyPeopleRunIds:['run']}}]}:sql.startsWith('SELECT 1')?{rows:[{active:1}]}:original(sql));expect(await reconcileWorkflowPeopleSnapshots(f.pool,{organizationId:'org',userId:'owner'},execution)).toBe(0);expect(f.query.mock.calls.some(([sql])=>sql.startsWith('UPDATE'))).toBe(false);});

it.each(['missing','running','unknown-status'])('keeps cancelled snapshot blocked for %s original Firmable proof',async kind=>{const f=fixture(['run'],kind==='missing'?[]:[{status:kind==='running'?'running':'unexpected',profilesFound:0,profilesSaved:0,profilesFailed:0}]);const original=f.query.getMockImplementation()!;f.query.mockImplementation(async sql=>sql.startsWith('SELECT config')?{rows:[{status:'cancelled',config:{companyPeopleRunIds:['run']}}]}:original(sql));expect(await reconcileWorkflowPeopleSnapshots(f.pool,{organizationId:'org',userId:'owner'},execution)).toBe(0);expect(f.query.mock.calls.some(([sql])=>sql.startsWith('UPDATE'))).toBe(false);});

it('admits a failed settled root while retaining every original job lifecycle and evidence field',async()=>{
 const f=fixture();const original=f.query.getMockImplementation()!;
 f.query.mockImplementation(async sql=>sql.startsWith('SELECT config')?{rows:sql.includes("status IN('complete','partial','failed','cancelled')")?[{status:'failed',config:{companyPeopleRunIds:['run']}}]:[]}:original(sql));
 expect(await reconcileWorkflowPeopleSnapshots(f.pool,{organizationId:'org',userId:'owner'},execution)).toBe(1);
 const update=f.query.mock.calls.find(([sql])=>sql.startsWith('UPDATE'))!;
 expect(update[0]).not.toContain('status=');expect(update[0]).not.toContain('updated_at');
 expect(JSON.parse(String(update[1]?.[1]))).toMatchObject({settled:true,cancelled:1,complete:0});
});
it('keeps a failed root blocked while an original job is still active',async()=>{
 const f=fixture();const original=f.query.getMockImplementation()!;
 f.query.mockImplementation(async sql=>sql.startsWith('SELECT config')?{rows:[{status:'failed',config:{companyPeopleRunIds:['run']}}]}:sql.startsWith('SELECT 1')?{rows:[{active:1}]}:original(sql));
 expect(await reconcileWorkflowPeopleSnapshots(f.pool,{organizationId:'org',userId:'owner'},execution)).toBe(0);
 expect(f.query.mock.calls.some(([sql])=>sql.startsWith('UPDATE'))).toBe(false);
});
it.each(['missing','running','unknown-status'])('keeps a failed root blocked for %s original Firmable proof',async kind=>{
 const f=fixture(['run'],kind==='missing'?[]:[{status:kind==='running'?'running':'unexpected',profilesFound:0,profilesSaved:0,profilesFailed:0}]);const original=f.query.getMockImplementation()!;
 f.query.mockImplementation(async sql=>sql.startsWith('SELECT config')?{rows:[{status:'failed',config:{companyPeopleRunIds:['run']}}]}:original(sql));
 expect(await reconcileWorkflowPeopleSnapshots(f.pool,{organizationId:'org',userId:'owner'},execution)).toBe(0);
 expect(f.query.mock.calls.some(([sql])=>sql.startsWith('UPDATE'))).toBe(false);
});
