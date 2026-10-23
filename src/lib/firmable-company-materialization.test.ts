import {beforeEach,expect,it,vi} from 'vitest';
import {emptyBrief,briefToMandate} from '@/domain/acquisition';
const m=vi.hoisted(()=>({lookup:vi.fn(),persist:vi.fn(),publish:vi.fn(),current:vi.fn(),write:vi.fn(),finding:vi.fn(),background:vi.fn()}));
vi.mock('@/db/client',()=>({requireDb:()=>db}));
vi.mock('@/db/company-identity-store',()=>({companyIdentityDrizzleClient:(tx:unknown)=>tx,getRecordedCompanyPersistence:m.lookup,persistResearchedCompany:m.persist}));
vi.mock('@/db/company-membership-projection-store',()=>({publishCompanyMembershipProjection:m.publish}));
vi.mock('./agent-research-context',()=>({assertNativeResearchPersistence:m.current}));
vi.mock('./company-background-research',()=>({queueCompanyBackgroundResearch:m.background}));
import {materializeFirmableCompany} from './firmable-company-materialization';
import {FirmableError} from '@/adapters/firmable-client';
const root='00000000-0000-4000-8000-000000000001',child='00000000-0000-4000-8000-000000000002',target='00000000-0000-4000-8000-000000000003',observation='00000000-0000-4000-8000-000000000004',mid='00000000-0000-4000-8000-000000000005';
const db={transaction:async<T>(run:(tx:unknown)=>Promise<T>)=>run(db),select:()=>({from:()=>({where:()=>({for:async()=>[{status:'extracting'}]})})}),update:()=>({set:m.write}),insert:()=>({values:m.finding})};
const raw={id:'f123',name:'Current factual company',website:'https://current.com',description:'We maintain fire protection equipment',region:{AU:{employee_count:35,address:{state:'VIC'}}}};
function input(){const b=emptyBrief();for(const[key,value]of[['subsectors','Fire protection maintenance'],['geography','VIC'],['headcount','18–90']])Object.assign(b.criteria.find(c=>c.key===key)!,{value,state:'specified',confirmed:true});return{job:{id:root,organizationId:'org',mandateId:mid,createdBy:'owner',createdAt:new Date('2026-10-18Z'),config:{nativeAgent:{version:1},companyIdentityPolicyVersion:1}},childId:child,childConfig:{},existingConfig:{},mandate:{...briefToMandate(b),brief:b},row:{id:'f123'},expectedDomain:'current.com',fetchProfile:vi.fn(async()=>({raw,matched:true,matchStatus:'matched'}))}as unknown as Parameters<typeof materializeFirmableCompany>[0];}
beforeEach(()=>{vi.clearAllMocks();m.lookup.mockResolvedValue(null);m.persist.mockResolvedValue({status:'persisted',targetId:target,observationId:observation});m.publish.mockResolvedValue({published:true});m.current.mockResolvedValue(undefined);m.write.mockReturnValue({where:async()=>[]});m.finding.mockReturnValue({onConflictDoNothing:async()=>[]});m.background.mockResolvedValue({jobId:null});});
it('uses the canonical target returned by the shared transaction and publishes only after saved company evidence',async()=>{
 const i=input();expect(await materializeFirmableCompany(i)).toMatchObject({ok:true,saved:true,targetId:target});
 expect(m.lookup).toHaveBeenCalledWith(db,{organizationId:'org',userId:'owner'},{jobId:child,requestKey:child});expect(m.lookup.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(i.fetchProfile).mock.invocationCallOrder[0]);
 const source=m.persist.mock.calls[0][2];expect(source).toMatchObject({requestKey:child,jobId:child,domain:'current.com',firmableId:'f123',sourceFacts:{firmableCompanyId:'f123'}});for(const key of['screening','scores','qualification','band','financeability','scoreExplanation'])expect(source.sourceFacts.firmographics).not.toHaveProperty(key);
 expect(m.publish).toHaveBeenCalledWith(db,{organizationId:'org',userId:'owner'},{mandateId:mid,targetId:target});expect(m.write.mock.calls.at(-1)?.[0].config.targetId).toBe(target);expect(m.background).not.toHaveBeenCalled();
});
it.each(['review_required','skipped']as const)('keeps %s source without inventing a saved company or starting follow-up research',async status=>{
 m.persist.mockResolvedValue({status,reviewId:root,observationId:observation});const i=input(),r=await materializeFirmableCompany(i);expect(r).toMatchObject({ok:true,saved:false,reviewId:root,...(status==='review_required'?{identityReviewRequired:true}:{skipped:true})});expect(r).not.toHaveProperty('targetId');expect(m.publish).not.toHaveBeenCalled();expect(m.background).not.toHaveBeenCalled();expect(m.write.mock.calls.at(-1)?.[0].config).not.toHaveProperty('targetId');
});
it.each(['persisted','review_required','skipped']as const)('replays original %s resolution without fetching or appending a second source observation',async status=>{
 const i=input();await materializeFirmableCompany(i);const config=m.write.mock.calls.at(-1)?.[0].config;m.write.mockClear();m.persist.mockClear();i.existingConfig=config;const receipt=status==='persisted'?{status,targetId:target,observationId:observation}:{status,reviewId:root,observationId:observation};m.lookup.mockResolvedValue(receipt);vi.mocked(i.fetchProfile).mockClear();
 expect(await materializeFirmableCompany(i)).toMatchObject({saved:status==='persisted'});expect(i.fetchProfile).not.toHaveBeenCalled();expect(m.persist).not.toHaveBeenCalled();
});
it('checks authority before provider work and again before writing a returned source',async()=>{
 const i=input();m.current.mockRejectedValueOnce(new Error('Paused'));await expect(materializeFirmableCompany(i)).rejects.toThrow('Paused');expect(i.fetchProfile).not.toHaveBeenCalled();m.current.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Changed'));await expect(materializeFirmableCompany(i)).rejects.toThrow('Changed');expect(i.fetchProfile).toHaveBeenCalledOnce();expect(m.persist).not.toHaveBeenCalled();expect(m.write).not.toHaveBeenCalled();
});
it('rejects a provider identity mismatch before accepted observation persistence',async()=>{const i=input();i.expectedDomain='different.com';await expect(materializeFirmableCompany(i)).rejects.toThrow('domain mismatch');expect(m.persist).not.toHaveBeenCalled();expect(m.write).not.toHaveBeenCalled();});
it('rejects a different provider ID than the selected discovery row even when its domain matches',async()=>{const i=input();i.row={id:'f999'};await expect(materializeFirmableCompany(i)).rejects.toThrow('requested Firmable identity');expect(m.persist).not.toHaveBeenCalled();expect(m.write).not.toHaveBeenCalled();});
it('records a known profile rate limit instead of leaving the child extracting, without inventing company evidence',async()=>{
 const i=input(),error=new FirmableError('/company',429,'Firmable request failed (429)');vi.mocked(i.fetchProfile).mockRejectedValueOnce(error);
 await expect(materializeFirmableCompany(i)).rejects.toBe(error);
 expect(m.current).toHaveBeenCalledTimes(2);expect(m.write).toHaveBeenCalledWith(expect.objectContaining({status:'failed',message:expect.stringContaining('429')}));
 expect(m.persist).not.toHaveBeenCalled();expect(m.publish).not.toHaveBeenCalled();expect(m.background).not.toHaveBeenCalled();
});
it('cannot record a provider failure after current research authority has been withdrawn',async()=>{
 const i=input();vi.mocked(i.fetchProfile).mockRejectedValueOnce(new FirmableError('/company',429,'Firmable request failed (429)'));m.current.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Research paused'));
 await expect(materializeFirmableCompany(i)).rejects.toThrow('Research paused');expect(m.write).not.toHaveBeenCalled();expect(m.persist).not.toHaveBeenCalled();
});

it('v4 retains a valid provider identity and fetched facts when no public website is available, without fabricating a membership',async()=>{
 const i=input();i.job.config={...(i.job.config as Record<string,unknown>),companyDiscoveryPolicy:{version:4}} as typeof i.job.config;i.row={id:'f123'};i.expectedDomain=undefined;vi.mocked(i.fetchProfile).mockResolvedValue({raw:{...raw,website:''},matched:true,matchStatus:'matched'});
 expect(await materializeFirmableCompany(i)).toMatchObject({ok:false,saved:false,firmableId:'f123'});expect(m.persist).not.toHaveBeenCalled();expect(m.publish).not.toHaveBeenCalled();
 const config=m.write.mock.calls.at(-1)?.[0].config;expect(m.write.mock.calls.at(-1)?.[0].status).toBe('partial');expect(config.identityIncomplete).toMatchObject({reason:'public_domain_missing',firmableId:'f123',sourceUrl:'https://app.firmable.com/dashboard/company/f123',profile:{name:raw.name}});
 i.existingConfig=config;vi.mocked(i.fetchProfile).mockClear();expect(await materializeFirmableCompany(i)).toMatchObject({ok:false,saved:false});expect(i.fetchProfile).not.toHaveBeenCalled();
});

it('v4 retains a known not-found profile outcome and lets other discovered companies continue',async()=>{
 const i=input();i.job.config={...(i.job.config as Record<string,unknown>),companyDiscoveryPolicy:{version:4}} as typeof i.job.config;vi.mocked(i.fetchProfile).mockRejectedValueOnce(new FirmableError('/company',404,'company_not_found'));
 expect(await materializeFirmableCompany(i)).toMatchObject({ok:false,saved:false,firmableId:'f123'});expect(m.persist).not.toHaveBeenCalled();expect(m.write.mock.calls.at(-1)?.[0]).toMatchObject({status:'partial',config:{companyProfileFailure:{firmableId:'f123',httpStatus:404}}});
 i.existingConfig=m.write.mock.calls.at(-1)?.[0].config;vi.mocked(i.fetchProfile).mockClear();expect(await materializeFirmableCompany(i)).toMatchObject({ok:false,saved:false});expect(i.fetchProfile).not.toHaveBeenCalled();
});
