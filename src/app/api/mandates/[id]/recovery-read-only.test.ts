import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({session:vi.fn(),mandate:vi.fn(),memberships:vi.fn(),coverage:vi.fn(),valuations:vi.fn(),execute:vi.fn(),latest:vi.fn(),claim:vi.fn(),fail:vi.fn(),worker:vi.fn(),recover:vi.fn(),contacts:vi.fn(),outreach:vi.fn(),db:{execute:vi.fn(),select:()=>({from:()=>({where:async()=>[{metadata:{}}]})})}}));
vi.mock('@/lib/auth',()=>({auth:{api:{getSession:m.session}}}));
vi.mock('@/db/client',()=>({requireDb:()=>m.db}));
vi.mock('@/db/acquisition-repository',()=>({AcquisitionRepository:class{getMandate=m.mandate;memberships=m.memberships;coverage=m.coverage;valuations=m.valuations;}}));
vi.mock('@/db/repositories',()=>({OrganizationRepository:class{}}));
vi.mock('@/lib/acquire-commands',()=>({acquireCommands:{execute:m.execute}}));
vi.mock('@/db/firmable-history-repository',()=>({FirmableHistoryRepository:class{latestRuns=m.latest;claimManualRecovery=m.claim;failRun=m.fail;}}));
vi.mock('@/db/firmable-read-model',()=>({loadWorkspaceContacts:m.contacts}));
vi.mock('@/db/outreach-view',()=>({loadOutreach:m.outreach}));
vi.mock('@/lib/research-service',()=>({researchEnabled:()=>true,researchWorker:m.worker}));
vi.mock('@/lib/firmable-run-recovery',()=>({recoverFirmableRefreshes:m.recover}));
import {GET as workspaceGET} from './route';
import {GET as outreachGET} from './outreach/route';
const mandateId='00000000-0000-4000-8000-000000000001',targetId='00000000-0000-4000-8000-000000000002';
const context={params:Promise.resolve({id:mandateId})};
const runs=[{id:'00000000-0000-4000-8000-000000000003',targetId,status:'queued',trigger:'people'},{id:'00000000-0000-4000-8000-000000000004',targetId,status:'running',trigger:'phones',updatedAt:new Date(0)}];
beforeEach(()=>{
 vi.resetAllMocks();vi.spyOn(console,'info').mockImplementation(()=>{});
 m.session.mockResolvedValue({user:{id:'current-actor'},session:{activeOrganizationId:'current-org'}});
 m.mandate.mockResolvedValue({id:mandateId});m.execute.mockResolvedValue({name:'mandate.read',value:{id:mandateId}});
 m.memberships.mockResolvedValue([{target:{id:targetId}}]);m.coverage.mockResolvedValue([]);m.valuations.mockResolvedValue([]);
 m.latest.mockResolvedValue(runs);m.contacts.mockResolvedValue([]);m.outreach.mockResolvedValue({views:[],canCompose:true});
 m.db.execute.mockResolvedValue({rows:[]});
});
function expectReadOnly(){expect(m.claim).not.toHaveBeenCalled();expect(m.fail).not.toHaveBeenCalled();expect(m.worker).not.toHaveBeenCalled();expect(m.recover).not.toHaveBeenCalled();}
it('workspace returns persisted active People runs once from current mandate memberships without advancing them',async()=>{
 const response=await workspaceGET(new Request(`http://localhost/api/mandates/${mandateId}`),context);
 expect(response.status).toBe(200);expect(await response.json()).toMatchObject({firmableRefreshes:runs.map(({updatedAt,...run})=>({...run,...(updatedAt?{updatedAt:updatedAt.toISOString()}:{})}))});
 expect(m.execute).toHaveBeenCalledExactlyOnceWith({organizationId:'current-org',userId:'current-actor'},{name:'mandate.read',input:{mandateId}});
 expect(m.memberships).toHaveBeenCalledExactlyOnceWith(mandateId);expect(m.latest).toHaveBeenCalledExactlyOnceWith('current-org',[targetId],undefined);expectReadOnly();
});
it('outreach returns its stored People run once and preserves the current user/mandate/company scope',async()=>{
 const response=await outreachGET(new Request(`http://localhost/api/mandates/${mandateId}/outreach?targetId=${targetId}`),context);
 expect(response.status).toBe(200);expect(await response.json()).toMatchObject({peopleRun:runs[0]});
 expect(m.mandate).toHaveBeenCalledExactlyOnceWith(mandateId);expect(m.latest).toHaveBeenCalledExactlyOnceWith('current-org',[targetId]);
 expect(m.outreach).toHaveBeenCalledExactlyOnceWith('current-org',mandateId,'current-actor',targetId);expectReadOnly();
});
it('does not expose another same-organisation mandate’s People run for a company outside current membership',async()=>{
 m.memberships.mockResolvedValue([]);
 const response=await outreachGET(new Request(`http://localhost/api/mandates/${mandateId}/outreach?targetId=${targetId}`),context);
 expect(response.status).toBe(404);expect(await response.json()).toMatchObject({error:'Company not found'});
 expect(m.memberships).toHaveBeenCalledExactlyOnceWith(mandateId,[targetId]);
 expect(m.latest).not.toHaveBeenCalled();expect(m.outreach).not.toHaveBeenCalled();expectReadOnly();
});
it('concurrent workspace reads remain reads rather than competing workflow recovery triggers',async()=>{
 const responses=await Promise.all([workspaceGET(new Request(`http://localhost/api/mandates/${mandateId}`),context),workspaceGET(new Request(`http://localhost/api/mandates/${mandateId}`),context)]);
 expect(responses.map(response=>response.status)).toEqual([200,200]);expect(m.latest).toHaveBeenCalledTimes(2);expectReadOnly();
});
it.each([workspaceGET,outreachGET])('rejects unauthenticated reads before looking up any provider history',async get=>{
 m.session.mockResolvedValue(null);expect((await get(new Request(`http://localhost/api/mandates/${mandateId}`),context)).status).toBe(401);
 expect(m.execute).not.toHaveBeenCalled();expect(m.mandate).not.toHaveBeenCalled();expect(m.latest).not.toHaveBeenCalled();expectReadOnly();
});
it.each([workspaceGET,outreachGET])('does not expose refresh rows from a mandate outside the current tenant',async get=>{
 m.execute.mockResolvedValue({name:'mandate.read',value:null});m.mandate.mockResolvedValue(null);
 expect((await get(new Request(`http://localhost/api/mandates/${mandateId}`),context)).status).toBe(404);
 expect(m.latest).not.toHaveBeenCalled();expect(m.outreach).not.toHaveBeenCalled();expectReadOnly();
});
