import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import type {Pool} from 'pg';
import {emptyBrief} from '@/domain/acquisition';
import {ensureInitialMandateResearch,readInitialMandateResearch} from './agent-initial-research';
vi.mock('./agent-runtime',()=>({agentStore:vi.fn()}));
vi.mock('./start-mandate-research',()=>({startMandateResearch:vi.fn()}));
const mandateId='10000000-0000-4000-8000-000000000001',actor={organizationId:'org',userId:'user'};
function fixture(overrides:Record<string,unknown>={}){
 const brief=emptyBrief();brief.criteria=brief.criteria.map(c=>c.key==='subsectors'?{...c,state:'specified',value:'Mining equipment refurbishment',confirmed:false}:c.key==='geography'?{...c,state:'specified',value:'WA',confirmed:false}:c);
 const row={filters:{brief},revision:'42',metadata:{creationRevision:'42',initialResearch:{version:1,requestId:mandateId,creationRevision:'42'}},...overrides};
 const query=vi.fn().mockResolvedValue({rows:[row]}),pool={query} as unknown as Pool;
 const store={openThread:vi.fn().mockResolvedValue({id:'thread'}),appendMessage:vi.fn(),executionState:vi.fn().mockResolvedValue({mandateRevision:'42',responsibility:null}),controlResponsibility:vi.fn().mockResolvedValue({id:"responsibility",revision:1,status:"ready"})};
 const start=vi.fn().mockResolvedValue({status:202,body:{jobId:mandateId}});
 return{row,pool,query,store,start,ports:{store:()=>store,start}};
}
it('starts from the saved intent and uses the ordinary action without confirming inferred fields',async()=>{
 const f=fixture();expect(await ensureInitialMandateResearch(f.pool,actor,mandateId,f.ports)).toEqual({requestId:mandateId,jobId:mandateId,status:'queued'});
 expect(f.start).toHaveBeenCalledWith(actor,mandateId,{requestId:mandateId,fromBrief:true},{expectedMandateRevision:'42',initialResponsibility:{id:'responsibility',revision:1,threadId:'thread'}});
 expect(f.store.appendMessage).toHaveBeenCalledWith('thread','initial-research-summary:'+mandateId,'assistant',{text:expect.stringContaining('Mining equipment refurbishment in WA')});
 expect(f.store.appendMessage.mock.invocationCallOrder[0]).toBeLessThan(f.start.mock.invocationCallOrder[0]);
 expect(f.row.filters.brief.criteria.filter(c=>['subsectors','geography'].includes(c.key)).every(c=>!c.confirmed)).toBe(true);
});
it('reuses existing queued, running and terminal roots without dispatch or new authority',async()=>{for(const status of ['queued','running','complete','partial','failed','cancelled']){const f=fixture({job_id:mandateId,job_status:status,job_created_by:actor.userId});expect(await ensureInitialMandateResearch(f.pool,actor,mandateId,f.ports)).toMatchObject({jobId:mandateId,status});expect(f.start).not.toHaveBeenCalled();expect(f.store.openThread).not.toHaveBeenCalled();}});
it('does not upgrade historical receipts or resume paused or edited mandates',async()=>{for(const update of [{metadata:{creationRevision:'42'}},{metadata:{creationRevision:'42',initialResearch:{version:1,requestId:'10000000-0000-4000-8000-000000000002',creationRevision:'42'}}},{responsibility_state:'paused'},{responsibility_state:'stopped'},{revision:'43'}]){const f=fixture(update);await ensureInitialMandateResearch(f.pool,actor,mandateId,f.ports);expect(f.start).not.toHaveBeenCalled();expect(f.store.controlResponsibility).not.toHaveBeenCalled();}});
it('viewing saved launch state is read-only',async()=>{const f=fixture();expect(await readInitialMandateResearch(f.pool,actor,mandateId)).toEqual({requestId:mandateId,status:'queued'});expect(f.query).toHaveBeenCalledOnce();expect(f.store.openThread).not.toHaveBeenCalled();expect(f.start).not.toHaveBeenCalled();});
it.each([{queued:1,active:0,partial:0,status:'extracting'},{queued:0,active:1,partial:0,status:'extracting'},{queued:0,active:0,partial:1,status:'partial'}])('projects legacy initial research children without claiming completion (%j)',async({status,...summary})=>{
 const f=fixture({job_id:mandateId,job_status:'complete',job_created_by:actor.userId,job_config:{companyPeopleProgress:{settled:true}},company_count:3,people_count:4,research_summary:{failed:0,cancelled:0,...summary}});
 expect(await readInitialMandateResearch(f.pool,actor,mandateId)).toMatchObject({status,companies:3,people:4});
 expect(f.start).not.toHaveBeenCalled();expect(f.store.openThread).not.toHaveBeenCalled();
});
it('does not claim a job started on unknown create/dispatch failure',async()=>{const f=fixture();f.start.mockResolvedValueOnce({status:503,body:{error:'unavailable'}} as never);await expect(ensureInitialMandateResearch(f.pool,actor,mandateId,f.ports)).rejects.toThrow('waiting');expect(f.start).toHaveBeenCalledOnce();});
it('rejects conflicting roots and never projects them as the submitted research',async()=>{for(const update of [{job_created_by:'another-user'},{job_created_by:actor.userId,native_root:true}]){const f=fixture({job_id:mandateId,job_status:'running',...update});expect(await readInitialMandateResearch(f.pool,actor,mandateId)).toEqual({requestId:mandateId,status:'conflict'});await expect(ensureInitialMandateResearch(f.pool,actor,mandateId,f.ports)).rejects.toThrow('conflicts');expect(f.start).not.toHaveBeenCalled();}});
function cachedFixture(presentation:'agent'|'workspace'='agent'){
 const f=fixture({company_count:1,people_count:2,cached_company_count:1}),selection={version:1,sourceMandateId:'10000000-0000-4000-8000-000000000002',sourceMandateRevision:'9',brief:f.row.filters.brief,targetIds:['10000000-0000-4000-8000-000000000003'],companyCount:1,peopleCount:2,sourceDigest:'a'.repeat(64)};
 Object.assign(f.row.metadata.initialResearch,{source:'cached',presentation,cachedDemo:{selection}});
 const attachCached=vi.fn().mockResolvedValue({sourceMandateId:selection.sourceMandateId,companyCount:1,peopleCount:2});
 return {...f,selection,attachCached,ports:{...f.ports,attachCached}};
}
it('loads cached demo memberships and chat without ever starting a live research job',async()=>{
 const f=cachedFixture();expect(await ensureInitialMandateResearch(f.pool,actor,mandateId,f.ports)).toMatchObject({source:'cached',status:'complete',companies:1,people:2});
 expect(f.attachCached).toHaveBeenCalledWith(f.pool,actor,mandateId,f.selection);expect(f.start).not.toHaveBeenCalled();expect(f.store.appendMessage).toHaveBeenCalledWith('thread','initial-cached-demo-ready:v2:'+mandateId,'assistant',expect.objectContaining({text:expect.stringContaining('no Firmable or live research request')}));
});
it('keeps an ordinary cached demo in the workspace without starting agent supervision or research',async()=>{
 const f=cachedFixture('workspace');expect(await ensureInitialMandateResearch(f.pool,actor,mandateId,f.ports)).toMatchObject({source:'cached',status:'complete'});expect(f.attachCached).toHaveBeenCalledOnce();expect(f.start).not.toHaveBeenCalled();expect(f.store.openThread).not.toHaveBeenCalled();expect(f.store.controlResponsibility).not.toHaveBeenCalled();
});
it('fails closed on missing cached data rather than falling back to a provider',async()=>{const f=cachedFixture();f.attachCached.mockRejectedValue(Error('cache changed'));await expect(ensureInitialMandateResearch(f.pool,actor,mandateId,f.ports)).rejects.toThrow('cache changed');expect(f.start).not.toHaveBeenCalled();expect(f.store.controlResponsibility).not.toHaveBeenCalled();});

it('does not run research or create supervision until Start for a chat-first intent, including background recovery',async()=>{
 const f=fixture();Object.assign(f.row.metadata.initialResearch,{startOn:'chat'});expect(await ensureInitialMandateResearch(f.pool,actor,mandateId,f.ports)).toMatchObject({status:'awaiting_start'});expect(await readInitialMandateResearch(f.pool,actor,mandateId)).toMatchObject({status:'awaiting_start'});expect(f.start).not.toHaveBeenCalled();expect(f.store.openThread).not.toHaveBeenCalled();
 Object.assign(f.row,{responsibility_state:'ready'});await ensureInitialMandateResearch(f.pool,actor,mandateId,f.ports);expect(f.start).toHaveBeenCalledOnce();
});
