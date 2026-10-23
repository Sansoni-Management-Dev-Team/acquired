import {beforeEach,expect,it,vi} from 'vitest';
import {emptyBrief,briefToMandate} from '@/domain/acquisition';
import {mandates,targets} from '@/db/schema';
import {buildAllDiscoveredCompanyPolicy,buildAllDiscoveredCompanyPeoplePolicy} from '@/domain/research-discovery-policy';
import {ResearchProviderError} from '@/domain/research-provider-error';
const m=vi.hoisted(()=>({materialize:vi.fn(),continuation:vi.fn(),assert:vi.fn(),profile:vi.fn(),insert:vi.fn(),update:vi.fn(),background:vi.fn(),search:vi.fn(),queuePeople:vi.fn(),automaticPeople:vi.fn()}));
vi.mock('@/lib/agent-runtime',()=>({agentStore:()=>({nativeCompanyContinuation:m.continuation})}));
vi.mock('@/db/client',()=>({requireDb:()=>db}));
vi.mock('./agent-research-context',()=>({assertNativeResearchPersistence:m.assert}));
vi.mock('./agent-research-firmable',()=>({createNativeFirmableTransport:()=>({enrichCompany:m.profile})}));
vi.mock('@/adapters/firmable-client',async importOriginal=>({...await importOriginal<typeof import('@/adapters/firmable-client')>(),FirmableClient:class{enrichCompany=m.profile}}));
vi.mock('./firmable-company-materialization',()=>({materializeFirmableCompany:m.materialize}));
vi.mock('./company-background-research',()=>({queueCompanyBackgroundResearch:m.background}));
vi.mock('@/adapters/cloudflare-web-search',()=>({cloudflareSearchResults:m.search}));
vi.mock('./company-people-research',()=>({queueCompanyPeople:m.queuePeople,tickCompanyPeople:vi.fn()}));
vi.mock('./agent-people-execution',()=>({executeNativeAutomaticCompanyPeople:m.automaticPeople}));
import {FirmableError} from '@/adapters/firmable-client';
import {firmableCompanyResearch} from './firmable-company-research';
const root='00000000-0000-4000-8000-000000000001',mandateId='00000000-0000-4000-8000-000000000002',targetId='00000000-0000-4000-8000-000000000003';
const brief=emptyBrief();let existing:Record<string,unknown>;
function result<T>(value:T){return{then:(resolve:(value:T)=>unknown,reject?:()=>unknown)=>Promise.resolve(value).then(resolve,reject),for:()=>Promise.resolve(value)};}
const db={select:()=>({from:(table:unknown)=>({where:()=>result(table===mandates?[{id:mandateId,organizationId:'org',filters:{...briefToMandate(brief),brief}}]:[{id:root,status:existing.status,config:existing.config}])})}),insert:(table:unknown)=>({values:(value:unknown)=>{m.insert(table,value);return{onConflictDoNothing:async()=>[]};}}),update:(table:unknown)=>({set:(value:unknown)=>{m.update(table,value);return{where:async()=>[]};}}),transaction:async<T>(work:(tx:unknown)=>Promise<T>)=>work(db)};
function job(policy=true,native=true){return{id:root,organizationId:'org',mandateId,createdBy:'owner',status:'extracting',createdAt:new Date('2026-10-18Z'),config:{pipelineDesign:'hybrid-firmable-v1',researchRunId:root,mode:'automatic',discover:true,workflow:'business',searchTerms:['Maintenance'],geography:'National',...(policy?{companyIdentityPolicyVersion:1}:{}),...(native?{nativeAgent:{version:1}}:{})}}as unknown as Parameters<typeof firmableCompanyResearch>[0];}
const payload={action:'d-company',row:{id:'f123',name:'Source company',website:'https://source.com'},expectedDomain:'source.com',sources:['firmable']};
beforeEach(()=>{vi.clearAllMocks();m.assert.mockResolvedValue(undefined);existing={status:'extracting',config:{}};m.profile.mockResolvedValue({id:'f123',name:'Source company',website:'https://source.com',description:'Maintenance'});m.materialize.mockResolvedValue({ok:true,saved:true,targetId,matched:true});m.background.mockResolvedValue({jobId:null});});
it.each([true,false])('uses the same canonical source materializer for new native=%s research, never legacy target insertion',async native=>{
 expect(await firmableCompanyResearch(job(true,native),payload)).toMatchObject({ok:true,saved:true,targetId});
 expect(m.materialize).toHaveBeenCalledWith(expect.objectContaining({job:expect.objectContaining({id:root}),childId:expect.stringMatching(/^[a-f0-9-]{36}$/),expectedDomain:'source.com',fetchProfile:expect.any(Function)}));
 expect(m.insert.mock.calls.filter(([table])=>table===targets)).toHaveLength(0);
 expect(m.profile).not.toHaveBeenCalled();
});
it('re-enters original canonical resolution after a completed identity review without repeating provider I/O',async()=>{
 existing={status:'complete',config:{companyIdentity:{status:'review_required',reviewId:root},firmableMatch:'matched'}};
 m.materialize.mockResolvedValue({ok:true,saved:false,identityReviewRequired:true,reviewId:root});
 expect(await firmableCompanyResearch(job(),payload)).toMatchObject({saved:false,identityReviewRequired:true});expect(m.materialize).toHaveBeenCalledOnce();expect(m.profile).not.toHaveBeenCalled();
});
it('preserves old frozen callbacks on their original root-derived target path',async()=>{
 existing={status:'complete',config:{targetId,firmableMatch:'matched',firmableCompanyId:'f123'}};
 expect(await firmableCompanyResearch(job(false),payload)).toMatchObject({ok:true,targetId});expect(m.materialize).not.toHaveBeenCalled();expect(m.profile).not.toHaveBeenCalled();
});
it('does not materialize or insert a child after the native source authority is revoked',async()=>{
 m.assert.mockRejectedValue(new Error('Native research context changed'));
 await expect(firmableCompanyResearch(job(),payload)).rejects.toThrow('Native research context changed');expect(m.materialize).not.toHaveBeenCalled();expect(m.insert).not.toHaveBeenCalled();expect(m.profile).not.toHaveBeenCalled();
});

it.each(['ambiguous_company','native_budget_admission_required','native_provider_reconciliation_required',undefined])('treats only a genuine ambiguous-company 409 as identity evidence, category %s',async category=>{
 const error=Object.assign(new FirmableError('/company',409,'Firmable request failed (409)'),{category});m.profile.mockRejectedValueOnce(error);m.materialize.mockImplementationOnce(async(value:{fetchProfile:()=>Promise<unknown>})=>value.fetchProfile());
 const pending=firmableCompanyResearch(job(),{action:'e-company',row:{domain:'source.com',name:'Source company',website:'https://source.com'},expectedDomain:'source.com',sources:['web']});
 if(category==='ambiguous_company')expect(await pending).toMatchObject({matched:false,matchStatus:'ambiguous'});else await expect(pending).rejects.toBe(error);
 expect(m.profile).toHaveBeenCalledOnce();
});
it.each([true,false])('preserves typed search refusal only for V4=%s without interpreting error messages',async v4=>{
 const current=job();if(v4)current.config={...current.config as object,companyDiscoveryPolicy:buildAllDiscoveredCompanyPolicy(),companyOnly:true,includeCompanyPeople:false,includePhones:false,findPeople:false};
 m.search.mockRejectedValueOnce(new ResearchProviderError('native_budget_admission_required',409));
 const r=await firmableCompanyResearch(current,{action:'e-search',index:0});expect(r).toMatchObject({ok:false,rows:[]});if(v4)expect(r).toHaveProperty('category','native_budget_admission_required');else expect(r).not.toHaveProperty('category');expect(m.search).toHaveBeenCalledOnce();
});

it('refuses changed continuation rows before child creation or profile I/O and permits only the original server-selected row',async()=>{const current=job();const original={candidateKey:'firmable:f123',domain:'source.com',sources:['firmable'],firmableRow:payload.row};current.config={...current.config as object,companyDiscoveryPolicy:buildAllDiscoveredCompanyPolicy(),companyOnly:true,includeCompanyPeople:false,includePhones:false,findPeople:false,nativeAgent:{version:1,threadId:root,operationId:targetId},companyContinuation:{version:1,sourceRootId:mandateId,sourceDigest:'a'.repeat(64),candidateKeys:['firmable:f123']}};m.continuation.mockResolvedValue({version:1,sourceRootId:mandateId,sourceDigest:'a'.repeat(64),candidates:[original]});const exact={...payload,candidateKey:'firmable:f123'};await expect(firmableCompanyResearch(current,{...exact,row:{...payload.row,name:'Changed source'}})).rejects.toThrow(/source|original|continuation/i);expect(m.insert).not.toHaveBeenCalled();expect(m.materialize).not.toHaveBeenCalled();expect(m.profile).not.toHaveBeenCalled();await expect(firmableCompanyResearch(current,exact)).resolves.toMatchObject({ok:true,saved:true});expect(m.continuation).toHaveBeenCalledWith(root,targetId);});

it('passes shared company operation correlation to internal search without changing native authority',async()=>{
 const {observeResearchOperation,withResearchDatabaseContext}=await import('./research-request-observability'),transport=vi.fn<typeof fetch>().mockResolvedValue(Response.json({results:[]}));vi.stubGlobal('fetch',transport);
 m.search.mockImplementationOnce(async(_query:string,fetcher:typeof fetch)=>{await fetcher('https://worker.example.invalid/search',{method:'POST',headers:{'x-existing-header':'retained'}});return [];});
 try{await withResearchDatabaseContext({mandateId:'outer-mandate-12345',runId:'outer-run-12345',jobId:'outer-job-12345',operationId:'operation-12345'},()=>observeResearchOperation('request-12345',()=>firmableCompanyResearch(job(),{action:'e-search',index:0})));
 const headers=new Headers(transport.mock.calls[0][1]?.headers);for(const[name,value]of Object.entries({'x-acquire-mandate-id':mandateId,'x-acquire-research-run':root,'x-acquire-research-job':root,'x-acquire-agent-operation':'operation-12345','x-request-id':'request-12345','x-existing-header':'retained','x-acquire-native-research-job':root}))expect(headers.get(name)).toBe(value);expect(headers.get('x-acquire-native-research-key')).toMatch(/^native:e-search:/);expect(transport).toHaveBeenCalledOnce();}finally{vi.unstubAllGlobals();}
});

function combined(native:boolean){const current=job(true,native);current.config={...current.config as object,companyDiscoveryPolicy:buildAllDiscoveredCompanyPeoplePolicy(),includeCompanyPeople:true,includePhones:false,findPeople:false};return current;}
it.each([false,true])('V5 automatically queues basic People only after canonical company persistence (native=%s)',async native=>{m.materialize.mockResolvedValue({ok:true,saved:true,targetId,firmableId:'f123'});m.automaticPeople.mockResolvedValue({status:'complete',saved:1,needsReview:0});await firmableCompanyResearch(combined(native),{...payload,candidateKey:'firmable:f123'});if(native){expect(m.automaticPeople).toHaveBeenCalledWith(expect.objectContaining({id:root}),{targetId,firmableId:'f123'});expect(m.queuePeople).not.toHaveBeenCalled();}else{expect(m.queuePeople).toHaveBeenCalledWith(expect.objectContaining({id:root}),targetId,'f123');expect(m.automaticPeople).not.toHaveBeenCalled();}expect(m.materialize.mock.invocationCallOrder[0]).toBeLessThan((native?m.automaticPeople:m.queuePeople).mock.invocationCallOrder[0]);});
it.each([{saved:false,reviewId:'review'},{saved:true,targetId}])('V5 does not fetch People without an accepted exact provider company identity',async result=>{m.materialize.mockResolvedValue({ok:true,...result});await firmableCompanyResearch(combined(true),{...payload,candidateKey:'firmable:f123'});expect(m.automaticPeople).not.toHaveBeenCalled();expect(m.queuePeople).not.toHaveBeenCalled();});
it('a queued People failure retains the accepted company result and does not repeat company discovery',async()=>{m.materialize.mockResolvedValue({ok:true,saved:true,targetId,firmableId:'f123'});m.queuePeople.mockRejectedValueOnce(Error('Queue unavailable'));expect(await firmableCompanyResearch(combined(false),{...payload,candidateKey:'firmable:f123'})).toMatchObject({ok:true,saved:true,targetId});expect(m.materialize).toHaveBeenCalledOnce();expect(m.profile).not.toHaveBeenCalled();});
