import {beforeEach,it,expect,vi} from 'vitest';
const m=vi.hoisted(()=>({append:vi.fn(),upsert:vi.fn(),attach:vi.fn(),progress:vi.fn(),transaction:vi.fn(),provider:vi.fn(),run:vi.fn()}));
vi.mock('server-only',()=>({}));
const id='11111111-1111-4111-8111-111111111111';
const source={id:'f1',fqdn:'example.test',name:'Example'};
vi.mock('@/db/client',()=>({requireDb:()=>({select:()=>({from:()=>({where:()=>({limit:async()=>[{targetId:id}]})})}),transaction:m.transaction})}));
vi.mock('@/db/firmable-history-repository',()=>({FirmableHistoryRepository:class{run=m.run;markRunning=async()=>{};findCompany=async()=>({id:'f1'});successfulCompanyResponse=async()=>({response:source});updateProgress=m.progress;}}));
vi.mock('@/db/acquisition-repository',()=>({AcquisitionRepository:class{getMandate=async()=>({brief:{}});memberships=async()=>[{target:{id,companyName:'Example',domain:'example.test',state:'VIC',sourceData:{firmable:{firmableId:'f1'}}}}];attach=m.attach;}}));
vi.mock('@/db/repositories',()=>({OrganizationRepository:class{upsertEnrichedTarget=m.upsert;}}));
vi.mock('@/domain/acquisition',()=>({briefToMandate:()=>({})}));
vi.mock('@/domain/scoring',()=>({rankTarget:(target:unknown)=>target}));
vi.mock('@/adapters/firmable-mapper',()=>({mapFirmableCompany:()=>({companyName:'Example',domain:'example.test',sourceData:{firmable:{firmableId:'f1',description:'New source fact'}},revenue:{value:2},sector:{value:'Water'}})}));
vi.mock('@/adapters/provider-mode',()=>({createTargetDataProvider:m.provider}));
vi.mock('@/lib/company-website',()=>({validateCompanyWebsite:async()=>({ok:true})}));
vi.mock('@/db/company-sync-observation-store',()=>({appendFirmableSyncCompanyObservation:m.append}));
import {refreshFirmableCompany} from './firmable-refresh';
beforeEach(()=>{vi.clearAllMocks();m.run.mockResolvedValue({id,organizationId:'org',actorId:'user',targetId:id,status:'running',trigger:'manual',companyStatus:'pending',generation:2,firmableCompanyId:'f1'});m.transaction.mockImplementation(async callback=>callback({execute:async()=>({rows:[]})}));m.append.mockResolvedValue({handled:true,targetId:id,observationId:id,replayed:false});m.upsert.mockResolvedValue({id});});
it('persists accepted membership refresh via genuine sync origin without legacy global buyer writes',async()=>{
 expect(await refreshFirmableCompany(id,id)).toEqual({companyId:'f1'});expect(m.append).toHaveBeenCalledOnce();expect(m.append.mock.calls[0][2]).toMatchObject({runId:id,mandateId:id,targetId:id,expectedGeneration:2,source:{domain:'example.test',firmableId:'f1'}});expect(m.upsert).not.toHaveBeenCalled();expect(m.attach).not.toHaveBeenCalled();expect(m.provider).not.toHaveBeenCalled();
});
it('preserves existing legacy upsert/attach when no accepted observation applies',async()=>{
 m.append.mockResolvedValue({handled:false,legacy:true});await refreshFirmableCompany(id,id);expect(m.append).toHaveBeenCalledOnce();expect(m.upsert).toHaveBeenCalledOnce();expect(m.attach).toHaveBeenCalledWith(id,id);expect(m.provider).not.toHaveBeenCalled();
});
it('does not fall through to legacy writes when current identity requires review',async()=>{
 m.append.mockRejectedValue(Error('Company identity requires review'));await expect(refreshFirmableCompany(id,id)).rejects.toThrow('requires review');expect(m.upsert).not.toHaveBeenCalled();expect(m.progress).not.toHaveBeenCalled();
});
