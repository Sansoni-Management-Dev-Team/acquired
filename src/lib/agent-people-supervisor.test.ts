import {AgentReadinessUnavailableError} from '@/db/agent-read-budget';
import {it,expect,vi} from 'vitest';
import {createResearchCompletedSupervisor,reuseCachedMandateTargets} from './agent-people-supervisor';
import type {AgentEventHandler} from './agent-event-worker';
const input=():Parameters<AgentEventHandler>[0]=>({event:{id:'12927bba-1515-482e-b8b6-3815403b5b7c',thread_id:'f4c4967a-9ee0-4a7a-a83e-e5594d69064f',kind:'research.completed',payload:{operationId:'700ea5af-232a-41b4-8f3e-d5e25dc75eab'},lease_owner:'cb4c241a-ff47-442c-b0f8-11a9c7a161b2',fence:'1',attempts:1},runId:'ac96f70a-ed75-48e7-819b-e699de7d0f53',signal:new AbortController().signal,assertCurrent:vi.fn().mockResolvedValue(undefined)});
function store(){return {researchCompletionInfo:vi.fn().mockResolvedValue({name:'research.start',result:{jobId:'00000000-0000-4000-8000-000000000099'}}),proposeFieldsResearch:vi.fn().mockResolvedValue(null),targetSelectionContext:vi.fn().mockResolvedValue({candidates:[]}),peopleResearchContext:vi.fn().mockResolvedValue({companies:[{firmableId:'f123',blockedReasons:[]}]}),proposePeopleResearch:vi.fn().mockResolvedValue({}),recordResearchNextStep:vi.fn().mockResolvedValue({})};}
it('uses cached contacts before new research without picking an account or creating a send',async()=>{const s=store();s.targetSelectionContext.mockResolvedValue({candidates:[{email:'owner@example.invalid',blockedReasons:[]}]});expect(await reuseCachedMandateTargets(s)(input())).toBe(true);expect(s.peopleResearchContext).not.toHaveBeenCalled();expect(s.proposePeopleResearch).not.toHaveBeenCalled();expect(s.recordResearchNextStep).toHaveBeenCalledWith(expect.any(String),expect.any(String),expect.objectContaining({kind:'cached_contacts'}),expect.any(Object));});
it('proposes separately reviewed people enrichment from cached companies before paying for company research',async()=>{const s=store();expect(await reuseCachedMandateTargets(s)(input())).toBe(true);expect(s.proposePeopleResearch).toHaveBeenCalledOnce();});
it('proposes the contact phase after company research but never loops an unsuccessful contact phase',async()=>{const s=store();expect(await createResearchCompletedSupervisor(s)(input())).toEqual({kind:'complete'});expect(s.proposePeopleResearch).toHaveBeenCalledOnce();s.proposePeopleResearch.mockClear();s.researchCompletionInfo.mockResolvedValue({name:'research.people'});await createResearchCompletedSupervisor(s)(input());expect(s.proposePeopleResearch).not.toHaveBeenCalled();expect(s.recordResearchNextStep).toHaveBeenCalledWith(expect.any(String),expect.any(String),expect.objectContaining({kind:'needs_review'}),expect.any(Object));});
it('falls through to a research proposal only when current cached work is ineligible',async()=>{const s=store();s.peopleResearchContext.mockResolvedValue({companies:[{firmableId:'f123',blockedReasons:['previously_contacted']}]});expect(await reuseCachedMandateTargets(s)(input())).toBe(false);expect(s.proposePeopleResearch).not.toHaveBeenCalled();});
it('prepares simulated recipients after durable demo people completion before reading outreach candidates, with the original job retry key',async()=>{
 const s=store(),prepare=vi.fn(async()=>({kind:'demo' as const,prepared:4})),completed={name:'research.people',mandateId:'00000000-0000-4000-8000-000000000001',executionMode:'demo',result:{jobId:'00000000-0000-4000-8000-000000000099',contacts:4}};
 s.researchCompletionInfo.mockResolvedValue(completed);const handler=createResearchCompletedSupervisor(s,{prepareDemoContacts:prepare});
 await handler(input());await handler(input());expect(prepare).toHaveBeenCalledTimes(2);expect(prepare.mock.calls[0]).toEqual(prepare.mock.calls[1]);expect(s.targetSelectionContext.mock.invocationCallOrder[0]).toBeGreaterThan(prepare.mock.invocationCallOrder[0]);
});
it('keeps real completions away from the testing service and stops before route selection on an uncertain demo preparation',async()=>{
 const s=store(),prepare=vi.fn().mockRejectedValue(Error('Original mapping response unknown'));
 s.researchCompletionInfo.mockResolvedValue({name:'research.people',mandateId:'00000000-0000-4000-8000-000000000001',executionMode:'real',result:{jobId:'00000000-0000-4000-8000-000000000099',contacts:4}});
 await createResearchCompletedSupervisor(s,{prepareDemoContacts:prepare})(input());expect(prepare).not.toHaveBeenCalled();
 s.targetSelectionContext.mockClear();s.researchCompletionInfo.mockResolvedValue({name:'research.people',mandateId:'00000000-0000-4000-8000-000000000001',executionMode:'demo',result:{jobId:'00000000-0000-4000-8000-000000000099',contacts:4}});
 expect(await createResearchCompletedSupervisor(s,{prepareDemoContacts:prepare})(input())).toMatchObject({kind:'review'});expect(s.targetSelectionContext).not.toHaveBeenCalled();
});
it('uses already admissible contacts before optional corporate enrichment after discovery',async()=>{
 const s=store();s.proposeFieldsResearch.mockResolvedValue({id:'fields-review'});s.targetSelectionContext.mockResolvedValue({candidates:[{email:'owner@example.invalid',blockedReasons:[]}]});
 await createResearchCompletedSupervisor(s)(input());
 expect(s.recordResearchNextStep).toHaveBeenCalledWith(expect.any(String),expect.any(String),expect.objectContaining({kind:'cached_contacts'}),expect.any(Object));
 expect(s.proposeFieldsResearch).not.toHaveBeenCalled();expect(s.peopleResearchContext).not.toHaveBeenCalled();expect(s.proposePeopleResearch).not.toHaveBeenCalled();
});
it('proposes bounded People review from current company evidence without requiring every public field',async()=>{
 const s=store();s.proposeFieldsResearch.mockResolvedValue({id:'fields-review'});
 await createResearchCompletedSupervisor(s)(input());
 expect(s.proposePeopleResearch).toHaveBeenCalledOnce();expect(s.proposeFieldsResearch).not.toHaveBeenCalled();
 expect(s.recordResearchNextStep).not.toHaveBeenCalled();
});
it('falls back to separately reviewed fields only when neither cached contacts nor current company identities can advance',async()=>{
 const s=store();s.peopleResearchContext.mockResolvedValue({companies:[{firmableId:'',blockedReasons:['missing_firmable_identity']}]});s.proposeFieldsResearch.mockResolvedValue({id:'fields-review'});
 await createResearchCompletedSupervisor(s)(input());
 expect(s.proposePeopleResearch).not.toHaveBeenCalled();expect(s.proposeFieldsResearch).toHaveBeenCalledOnce();
 expect(s.proposeFieldsResearch.mock.invocationCallOrder[0]).toBeGreaterThan(s.peopleResearchContext.mock.invocationCallOrder[0]);
 expect(s.recordResearchNextStep).not.toHaveBeenCalled();
});
it('reassesses readiness after public fields and never retries personal enrichment after an empty People phase',async()=>{
 const s=store();s.researchCompletionInfo.mockResolvedValue({name:'research.fields',input:{sourceRootId:'00000000-0000-4000-8000-000000000099'},result:{jobId:'00000000-0000-4000-8000-000000000098'}});
 await createResearchCompletedSupervisor(s)(input());expect(s.proposePeopleResearch).toHaveBeenCalledOnce();expect(s.proposeFieldsResearch).not.toHaveBeenCalled();
 s.proposePeopleResearch.mockClear();s.researchCompletionInfo.mockResolvedValue({name:'research.people',result:{jobId:'00000000-0000-4000-8000-000000000097',contacts:0}});
 await createResearchCompletedSupervisor(s)(input());expect(s.proposePeopleResearch).not.toHaveBeenCalled();expect(s.proposeFieldsResearch).not.toHaveBeenCalled();
 expect(s.recordResearchNextStep).toHaveBeenCalledWith(expect.any(String),expect.any(String),expect.objectContaining({kind:'needs_review'}),expect.any(Object));
});
it('reuses real researched source people before new provider spend even while their demo delivery mapping needs setup',async()=>{
 const s=store();s.targetSelectionContext.mockResolvedValue({candidates:[{email:'',blockedReasons:['demo_mapping_required']}]});
 expect(await reuseCachedMandateTargets(s)(input())).toBe(true);expect(s.proposePeopleResearch).not.toHaveBeenCalled();expect(s.peopleResearchContext).not.toHaveBeenCalled();
 expect(s.recordResearchNextStep).toHaveBeenCalledWith(expect.anything(),expect.anything(),expect.objectContaining({kind:'cached_contacts'}),expect.anything());
});
it('prepares already researched people reused by company discovery before selecting channels or proposing redundant enrichment',async()=>{
 const s=store(),prepare=vi.fn(async()=>({kind:'demo' as const,prepared:1}));
 s.researchCompletionInfo.mockResolvedValue({name:'research.start',executionMode:'demo',mandateId:'00000000-0000-4000-8000-000000000001',result:{jobId:'00000000-0000-4000-8000-000000000099',contacts:1}});
 s.targetSelectionContext.mockResolvedValueOnce({candidates:[{email:'',blockedReasons:['demo_mapping_required']}]}).mockResolvedValueOnce({candidates:[{email:'lead-001@demo.leads.acquire.test',blockedReasons:[]}]});
 expect(await createResearchCompletedSupervisor(s,{prepareDemoContacts:prepare})(input())).toEqual({kind:'complete'});expect(prepare).toHaveBeenCalledOnce();expect(s.targetSelectionContext).toHaveBeenCalledTimes(2);expect(s.proposePeopleResearch).not.toHaveBeenCalled();
});

it('returns a bounded-read review without new People or Fields authority when company readiness times out',async()=>{const s=store();s.peopleResearchContext.mockRejectedValue(new AgentReadinessUnavailableError(Object.assign(Error('private SQL trace'),{code:'57014'})));expect(await createResearchCompletedSupervisor(s)(input())).toEqual({kind:'review',message:expect.stringContaining('Company readiness is temporarily unavailable')});expect(s.proposePeopleResearch).not.toHaveBeenCalled();expect(s.proposeFieldsResearch).not.toHaveBeenCalled();expect(s.recordResearchNextStep).not.toHaveBeenCalled();});
it('does not disguise an unrelated original outcome failure as a retryable readiness review',async()=>{const s=store(),failure=Error('Original effect needs reconciliation');s.peopleResearchContext.mockRejectedValue(failure);await expect(createResearchCompletedSupervisor(s)(input())).rejects.toBe(failure);});

it('reviews the saved combined V5 results without proposing a second People or fields phase when contacts are not routable',async()=>{
 const s=store();s.researchCompletionInfo.mockResolvedValue({name:'research.start',input:{config:{companyDiscoveryPolicy:{version:5}}},result:{jobId:'00000000-0000-4000-8000-000000000099',contacts:3}});
 await createResearchCompletedSupervisor(s)(input());
 expect(s.peopleResearchContext).not.toHaveBeenCalled();expect(s.proposePeopleResearch).not.toHaveBeenCalled();expect(s.proposeFieldsResearch).not.toHaveBeenCalled();
 expect(s.recordResearchNextStep).toHaveBeenCalledWith(expect.anything(),expect.anything(),expect.objectContaining({kind:'needs_review',message:expect.stringContaining('basic people')}),expect.anything());
});
