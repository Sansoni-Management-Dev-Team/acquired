import {beforeEach,expect,it,vi} from 'vitest';
import {PgDialect} from 'drizzle-orm/pg-core';
const m=vi.hoisted(()=>({session:vi.fn(),mandate:vi.fn(),members:vi.fn(),latest:vi.fn(),read:vi.fn(),outreach:vi.fn()}));
vi.mock('@/lib/auth',()=>({auth:{api:{getSession:m.session}}}));
vi.mock('@/db/acquisition-repository',()=>({AcquisitionRepository:class{getMandate=m.mandate;memberships=m.members;}}));
vi.mock('@/db/firmable-history-repository',()=>({FirmableHistoryRepository:class{latestRuns=m.latest;}}));
vi.mock('@/db/client',()=>({requireDb:()=>({execute:m.read})}));
vi.mock('@/db/outreach-view',()=>({loadOutreach:m.outreach}));
import {GET} from './route';
const mandate='00000000-0000-4000-8000-000000000001',target='00000000-0000-4000-8000-000000000002',child='00000000-0000-4000-8000-000000000003';
const context={params:Promise.resolve({id:mandate})},request=()=>new Request(`http://localhost/api/mandates/${mandate}/outreach?targetId=${target}`);
const native=()=>({id:child,rootStatus:'extracting',operationState:'running',profilesFound:3,profilesSaved:1,result:null,createdAt:new Date('2026-10-19T00:00:00Z'),updatedAt:new Date('2026-10-19T00:01:00Z')});
beforeEach(()=>{vi.resetAllMocks();m.session.mockResolvedValue({session:{activeOrganizationId:'org'},user:{id:'actor'}});m.mandate.mockResolvedValue({id:mandate});m.members.mockResolvedValue([{target:{id:target}}]);m.latest.mockResolvedValue([]);m.read.mockResolvedValue({rows:[]});m.outreach.mockResolvedValue({views:[]});});

it('projects active native basic People into the existing polling shape without exposing source data or advancing work',async()=>{
 m.read.mockResolvedValue({rows:[{...native(),privatePayload:'hidden provider response'}]});
 const response=await GET(request(),context),body=await response.json();
 expect(response.status).toBe(200);expect(body.peopleRun).toMatchObject({id:child,status:'running',profilesFound:3,profilesSaved:1,source:'native_automatic_people'});
 expect(response.headers.get('Cache-Control')).toBe('no-store');expect(JSON.stringify(body)).not.toContain('hidden provider response');
 const query=new PgDialect().sqlToQuery(m.read.mock.calls[0][0]);
 for(const guard of ['root.organization_id','root.mandate_id','root.created_by','candidate.organization_id=root.organization_id','candidate.mandate_id=root.mandate_id','parent.owner_user_id=root.created_by','companyDiscoveryPolicy','companyIdentity','automaticPeopleResult'])expect(query.sql).toContain(guard);
 for(const value of ['org','actor',mandate,target])expect(query.params).toContain(value);
 expect(query.sql).toContain("candidate.config->'companyIdentity'->>'status'='persisted'");
 expect(query.sql.trimStart().startsWith('SELECT')).toBe(true);expect(query.sql).not.toMatch(/UPDATE|INSERT|DELETE|FOR UPDATE/);
 expect(m.outreach).toHaveBeenCalledExactlyOnceWith('org',mandate,'actor',target);
});
it.each(['complete','partial'])('projects %s native People counts from the saved child outcome',async status=>{
 m.read.mockResolvedValue({rows:[{...native(),rootStatus:'partial',result:{status,saved:2,needsReview:status==='partial'?1:0}}]});
 const response=await GET(request(),context);expect((await response.json()).peopleRun).toMatchObject({status,profilesSaved:2,profilesFound:3});
});
it('shows a terminal root without a People outcome as partial rather than polling forever',async()=>{
 m.read.mockResolvedValue({rows:[{...native(),rootStatus:'partial'}]});
 expect((await (await GET(request(),context)).json()).peopleRun).toMatchObject({status:'partial',profilesSaved:1});
 m.read.mockResolvedValue({rows:[{...native(),rootStatus:'partial',profilesSaved:2,result:{status:'partial',saved:0,needsReview:1}}]});
 expect((await (await GET(request(),context)).json()).peopleRun.profilesSaved).toBe(2);
});
it('preserves a manual run but does not let historical terminal sync hide active native work',async()=>{
 const manual={id:'manual-run',status:'complete',updatedAt:new Date('2026-10-18T00:00:00Z')};m.latest.mockResolvedValue([manual]);
 expect((await (await GET(request(),context)).json()).peopleRun.id).toBe(manual.id);
 m.read.mockResolvedValue({rows:[native()]});expect((await (await GET(request(),context)).json()).peopleRun.id).toBe(child);
 m.latest.mockResolvedValue([{...manual,status:'running'}]);expect((await GET(request(),context)).status).toBe(409);
 m.latest.mockResolvedValue([]);m.read.mockResolvedValue({rows:[native(),{...native(),id:'00000000-0000-4000-8000-000000000004'}]});expect((await GET(request(),context)).status).toBe(409);
 m.read.mockResolvedValue({rows:[{...native(),rootStatus:'complete',result:{status:'complete',saved:1,needsReview:0}}]});m.latest.mockResolvedValue([{...manual,updatedAt:new Date('2026-10-20T00:00:00Z')}]);
 expect((await (await GET(request(),context)).json()).peopleRun.id).toBe(manual.id);
});
it('rejects cross-tenant or nonmember company reads before querying native status',async()=>{
 m.mandate.mockResolvedValueOnce(null);expect((await GET(request(),context)).status).toBe(404);
 m.members.mockResolvedValueOnce([]);expect((await GET(request(),context)).status).toBe(404);
 expect(m.read).not.toHaveBeenCalled();expect(m.latest).not.toHaveBeenCalled();expect(m.outreach).not.toHaveBeenCalled();
});
