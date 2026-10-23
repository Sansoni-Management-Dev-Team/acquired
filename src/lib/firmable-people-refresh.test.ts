import {getTableName} from 'drizzle-orm';
import {buildAllDiscoveredCompanyPeoplePolicy} from '@/domain/research-discovery-policy';
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  root:vi.fn(), searchPage:vi.fn(), search:vi.fn(), reconcile:vi.fn(), provider: vi.fn(), run: vi.fn(), candidates: vi.fn(), stored: vi.fn(), progress: vi.fn(), update: vi.fn(), enrich: vi.fn(), save: vi.fn(),
}));
vi.mock("@/db/client", () => ({ requireDb: () => ({ select: () => ({ from: (table:Parameters<typeof getTableName>[0]) => {const rows=()=>getTableName(table)==='research_jobs'?mocks.root():Promise.resolve([]);return{where:()=>({limit:rows,then:(resolve:(rows:unknown[])=>unknown)=>rows().then(resolve)})};} }) }) }));
vi.mock("@/db/firmable-history-repository", () => ({ FirmableHistoryRepository: class {
  successfulSearchPage=mocks.searchPage;reconcilePeople=mocks.reconcile;
  run = mocks.run; searchCandidates = mocks.candidates; successfulPersonResponse = mocks.stored;
  profileProgress = mocks.progress; updateProgress = mocks.update; reconcileProfileProgress = mocks.progress;
} }));
vi.mock("@/adapters/provider-mode", () => ({ createTargetDataProvider: mocks.provider }));
vi.mock("@/db/firmable-contacts", () => ({ upsertFirmableContact: mocks.save }));
import { executeFirmablePeopleProfiles, refreshFirmableProfileBatch, refreshFirmablePeoplePage, finalizeFirmablePeopleSearch } from "./firmable-refresh";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.provider.mockReturnValue({firmable:{enrichPerson:mocks.enrich,searchPeoplePage:mocks.search}});mocks.root.mockResolvedValue([]);
  mocks.run.mockResolvedValue({ id: "run", trigger: "people", organizationId: "org", targetId: "target", firmableCompanyId: "company" });
  mocks.candidates.mockResolvedValue({ candidates: [{ id: "person" }] });
  mocks.stored.mockResolvedValue(undefined);
  mocks.progress.mockResolvedValue({ found: 1, saved: 1, failed: 0, pending: 0 });
  mocks.enrich.mockResolvedValue({ id: "person", name: "Alex", phone: "0400000000", phoneAvailable: true });
});

it("loads profiles without requesting phone unlocks and saves people for the list", async () => {
  expect(await refreshFirmableProfileBatch("run", 0)).toMatchObject({ saved: 1, complete: true });
  expect(mocks.enrich).toHaveBeenCalledWith({ id: "person" }, { includePhones: false });
  expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
    targetId: "target", person: expect.objectContaining({ name: "Alex", phone: undefined, phoneAvailable: false }),
  }));
});
it('RC-11-regression: an admitted batch reconciles each individual write before aggregate settlement', async () => {
  mocks.candidates.mockResolvedValue({ candidates: [{ id: 'a' }, { id: 'b' }] });
  let resolveSlow!: (value: unknown) => void;
  mocks.enrich.mockImplementation(({id}: {id:string}) => id==='a' ? Promise.resolve({id,name:'Synthetic Owner'}) : new Promise(resolve=>{resolveSlow=resolve;}));
  const batch=refreshFirmableProfileBatch('run',0);
  await vi.waitFor(()=>expect(mocks.save).toHaveBeenCalledTimes(1));
  expect(mocks.progress).toHaveBeenCalledTimes(1);
  expect(mocks.update).not.toHaveBeenCalled();
  resolveSlow({id:'b',name:'Synthetic Director'});await batch;
  expect(mocks.progress).toHaveBeenCalledTimes(3);
});
it('RC-11-generalization: database write errors cannot be reported as saved, and terminal callbacks admit no work',async()=>{
  mocks.save.mockRejectedValueOnce(new Error('database write failure'));
  await expect(refreshFirmableProfileBatch('run',0)).rejects.toThrow('database write failure');
  expect(mocks.update).not.toHaveBeenCalled();
  for(const status of ['failed','complete','partial']) {
    mocks.run.mockResolvedValue({status});
    const before=mocks.enrich.mock.calls.length;
    await expect(refreshFirmableProfileBatch('run',0)).rejects.toThrow('terminal');
    expect(mocks.enrich.mock.calls.length).toBe(before);
  }
});

// Characterization of history reuse and caller-specific legacy phone authority.
it('reuses a saved profile response without a second provider request', async () => {
  mocks.stored.mockResolvedValue({response:{id:'person', first_name:'Alex', last_name:'Owner'}});
  await refreshFirmableProfileBatch('run', 0);
  expect(mocks.enrich).not.toHaveBeenCalled();
  expect(mocks.save).toHaveBeenCalledTimes(1);
});
it('retains the existing manual refresh phone permission while automatic People remains phone-free', async () => {
  mocks.run.mockResolvedValue({id:'run',trigger:'manual',organizationId:'org',targetId:'target',firmableCompanyId:'company'});
  await refreshFirmableProfileBatch('run', 0);
  expect(mocks.enrich).toHaveBeenCalledWith({id:'person'}, {includePhones:true});
  expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({person:expect.objectContaining({phone:'0400000000'})}));
});

function execution() {
  return {
    candidates:[{id:'person',emailAvailable:true,phoneAvailable:true}],includePhones:false,concurrency:'serial' as const,
    recorded:vi.fn().mockResolvedValue(undefined),admissible:vi.fn().mockResolvedValue(true),
    enrich:vi.fn().mockResolvedValue({id:'person',name:'Alex',phone:'0400000000',phoneAvailable:true,emailAvailable:true,fictionalised:false,doNotContact:false}),
    persist:vi.fn().mockResolvedValue(true),failure:vi.fn((error:unknown)=>{throw error;}),settled:vi.fn().mockResolvedValue(undefined),
  };
}
it('shared execution reuses a recorded outcome before a reveal and preserves the original receipt',async()=>{
 const input=execution();input.recorded.mockResolvedValue({kind:'saved',saved:true});
 expect(await executeFirmablePeopleProfiles(input)).toEqual({saved:1,needsReview:0});
 expect(input.enrich).not.toHaveBeenCalled();expect(input.persist).not.toHaveBeenCalled();expect(input.admissible).not.toHaveBeenCalled();expect(input.settled).toHaveBeenCalledTimes(1);
});
it('shared execution blocks a stale or conflicted identity before revealing a profile',async()=>{
 const input=execution();input.admissible.mockResolvedValue(false);
 expect(await executeFirmablePeopleProfiles(input)).toEqual({saved:0,needsReview:1});
 expect(input.enrich).not.toHaveBeenCalled();expect(input.persist).not.toHaveBeenCalled();
});
it('shared execution strips incidental phones and reports refused persistence as review',async()=>{
 const input=execution();input.persist.mockResolvedValue(false);
 expect(await executeFirmablePeopleProfiles(input)).toEqual({saved:0,needsReview:1});
 expect(input.enrich).toHaveBeenCalledWith({id:'person'},{includePhones:false});
 expect(input.persist).toHaveBeenCalledWith(expect.objectContaining({phone:undefined,phoneAvailable:false,phoneLookupStatus:'not_requested'}),input.candidates[0]);
});
it('shared parallel execution drains admitted work before propagating a write failure',async()=>{
 const input={...execution(),concurrency:'parallel' as const,candidates:[{id:'a',emailAvailable:true,phoneAvailable:false},{id:'b',emailAvailable:true,phoneAvailable:false}]};
 let finishSlow!:()=>void;
 input.enrich.mockImplementation(async ({id}:{id:string})=>{if(id==='b')await new Promise<void>(resolve=>{finishSlow=resolve;});return {id,emailAvailable:true,phoneAvailable:false,fictionalised:false,doNotContact:false};});
 input.persist.mockImplementation(async person=>{if(person.id==='a')throw new Error('Saved source became stale');return true;});
 const pending=executeFirmablePeopleProfiles(input);
 await vi.waitFor(()=>expect(input.failure).toHaveBeenCalledTimes(1));
 expect(input.settled).toHaveBeenCalledTimes(1);
 finishSlow();await expect(pending).rejects.toThrow('Saved source became stale');
 expect(input.settled).toHaveBeenCalledTimes(2);
});

it('traces failed batches without logging contacts, provider payloads or exception messages',async()=>{
 const trace=vi.spyOn(console,'info').mockImplementation(()=>{});
 try {
  const input=execution();input.enrich.mockRejectedValue(new Error('Private contact secret@example.invalid token-value'));
  await expect(executeFirmablePeopleProfiles(input)).rejects.toThrow('Private contact');
  const output=trace.mock.calls.map(call=>call.join(' ')).join(' ');
  expect(output).toContain('people_profiles_finished');expect(output).toContain('"outcome":"failed"');
  expect(output).not.toContain('secret@example.invalid');expect(output).not.toContain('token-value');expect(output).not.toContain('0400000000');
 } finally {trace.mockRestore();}
});

it('passes current operation correlation and the explicit refresh run to the shared provider factory',async()=>{
 const {observeResearchOperation,withResearchDatabaseContext}=await import('./research-request-observability');
 await withResearchDatabaseContext({mandateId:'mandate-12345',runId:'outer-run-12345',jobId:'job-12345',operationId:'operation-12345'},()=>observeResearchOperation('request-12345',()=>refreshFirmableProfileBatch('run',0)));
 expect(mocks.provider).toHaveBeenCalledWith(undefined,expect.objectContaining({traceContext:{mandateId:'mandate-12345',runId:'run',jobId:'job-12345',operationId:'operation-12345',requestId:'request-12345'}}));
});

const sourceRoot='00000000-0000-4000-8000-000000000001',sourceTarget='00000000-0000-4000-8000-000000000002';
function v5Discovery(){
 mocks.run.mockResolvedValue({id:'run',trigger:'discovery',organizationId:'org',actorId:'actor',targetId:sourceTarget,firmableCompanyId:'f123',requestKey:`discovery:${sourceRoot}:${sourceTarget}`});
 const root={id:sourceRoot,organizationId:'org',createdBy:'actor',config:{companyIdentityPolicyVersion:1,includeCompanyPeople:true,includePhones:false,findPeople:false,companyDiscoveryPolicy:buildAllDiscoveredCompanyPeoplePolicy(),companyPeopleRunIds:['run']}};
 mocks.root.mockResolvedValue([root]);return root;
}
it('limits a V5 automatic profile batch to the exact three frozen contacts without requesting phones',async()=>{
 v5Discovery();mocks.candidates.mockResolvedValue({candidates:Array.from({length:5},(_,i)=>({id:'person-'+i}))});
 expect(await refreshFirmableProfileBatch('run',0)).toMatchObject({complete:true,nextOffset:3});
 expect(mocks.enrich).toHaveBeenCalledTimes(3);expect(mocks.enrich.mock.calls.every(call=>call[1].includePhones===false)).toBe(true);
 expect(mocks.stored.mock.calls.map(call=>call[1])).toEqual(['person-0','person-1','person-2']);
});
it('uses the frozen V5 one-page fifty-row search envelope and refuses a second request',async()=>{
 v5Discovery();mocks.searchPage.mockResolvedValueOnce(undefined).mockResolvedValueOnce({returnedCount:50});
 mocks.candidates.mockResolvedValue({candidates:[],discoveredCount:0,reportedTotals:[],malformedCount:0});
 expect(await refreshFirmablePeoplePage('run',0)).toMatchObject({complete:true});
 expect(mocks.search).toHaveBeenCalledWith('f123',{max:50,from:0});
 await expect(refreshFirmablePeoplePage('run',100)).rejects.toThrow(/frozen.*search|search.*scope/i);expect(mocks.search).toHaveBeenCalledOnce();
});
it('saves only the frozen V5 selected relationships before profile execution',async()=>{
 v5Discovery();mocks.candidates.mockResolvedValue({candidates:Array.from({length:5},(_,i)=>({id:'person-'+i}))});
 expect(await finalizeFirmablePeopleSearch('run')).toMatchObject({complete:true,nextOffset:3,found:3});
 expect(mocks.reconcile.mock.calls[0][2]).toHaveLength(3);
});
it.each(['unlinked','foreign_actor','native','phone_scope','wrong_target'])('refuses an automatic V5 %s source before profile requests',async reason=>{
 const root=v5Discovery();if(reason==='unlinked')root.config.companyPeopleRunIds=[];if(reason==='foreign_actor')root.createdBy='other';if(reason==='native')Object.assign(root.config,{nativeAgent:{providerAdmission:'hybrid-company-v1'}});if(reason==='phone_scope')root.config.includePhones=true;if(reason==='wrong_target')mocks.run.mockResolvedValue({...await mocks.run(),requestKey:`discovery:${sourceRoot}:00000000-0000-4000-8000-000000000003`});
 await expect(refreshFirmableProfileBatch('run',0)).rejects.toThrow(/source|native|authority/i);expect(mocks.enrich).not.toHaveBeenCalled();expect(mocks.save).not.toHaveBeenCalled();
});
it('keeps five selected profiles for a historical manual refresh',async()=>{
 mocks.run.mockResolvedValue({id:'run',trigger:'manual',organizationId:'org',targetId:'target',firmableCompanyId:'company'});mocks.candidates.mockResolvedValue({candidates:Array.from({length:5},(_,i)=>({id:'person-'+i}))});
 await refreshFirmableProfileBatch('run',0);expect(mocks.enrich).toHaveBeenCalledTimes(5);expect(mocks.root).not.toHaveBeenCalled();
});

it('preserves legacy workforce batches beyond the bounded automatic contact subset',async()=>{
 mocks.run.mockResolvedValue({id:'run',trigger:'full',organizationId:'org',targetId:'target',firmableCompanyId:'company'});mocks.candidates.mockResolvedValue({candidates:Array.from({length:6},(_,i)=>({id:'person-'+i}))});
 expect(await refreshFirmableProfileBatch('run',5)).toMatchObject({complete:true,nextOffset:6});expect(mocks.enrich).toHaveBeenCalledWith({id:'person-5'},{includePhones:true});expect(mocks.root).not.toHaveBeenCalled();
});
