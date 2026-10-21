import {AgentReadinessUnavailableError} from '@/db/agent-read-budget';
import {describe,it,expect,vi} from 'vitest';
import {createResearchSupervisor} from './agent-research-supervisor';
import type {AgentEventHandler} from './agent-event-worker';
const responsibilityId='fc12b514-dfd7-42da-98b7-447591464c33';
function event():Parameters<AgentEventHandler>[0]{return {event:{id:'12927bba-1515-482e-b8b6-3815403b5b7c',thread_id:'f4c4967a-9ee0-4a7a-a83e-e5594d69064f',kind:'mandate.supervise',payload:{responsibilityId,revision:2},lease_owner:'cb4c241a-ff47-442c-b0f8-11a9c7a161b2',fence:'3',attempts:1},runId:'ac96f70a-ed75-48e7-819b-e699de7d0f53',signal:new AbortController().signal,assertCurrent:vi.fn().mockResolvedValue(undefined)};}
const current=()=>({mandateRevision:'123',responsibility:{id:responsibilityId,revision:2,state:'ready',mandateRevision:'123'}});
describe('research event supervision',()=>{
 it('fences a stable proposal derived from server context',async()=>{
  const state=current(),proposeResearchPlan=vi.fn().mockResolvedValue({}),input=event();
  const handler=createResearchSupervisor({researchSupervisionContext:vi.fn().mockResolvedValue(state),proposeResearchPlan});
  expect(await handler(input)).toEqual({kind:'complete'});
  expect(input.assertCurrent).toHaveBeenCalledOnce();
  expect(proposeResearchPlan).toHaveBeenCalledWith(input.event.thread_id,'research-supervision:'+responsibilityId+':2',{responsibilityId,responsibilityRevision:2,mandateRevision:'123'},{runId:input.runId,eventId:input.event.id,leaseOwner:input.event.lease_owner,fence:'3'});
 });
 it('ignores old events and paused ownership without a new plan',async()=>{
  for(const update of [{revision:3},{state:'paused'},{id:'e1ce85a3-dcb4-4faf-9bed-d5e14051f274'}]){
   const s=current();Object.assign(s.responsibility,update);const proposeResearchPlan=vi.fn();
   expect(await createResearchSupervisor({researchSupervisionContext:vi.fn().mockResolvedValue(s),proposeResearchPlan})(event())).toEqual({kind:'complete'});expect(proposeResearchPlan).not.toHaveBeenCalled();
  }
 });
 it('requires renewed review when the saved mandate changes',async()=>{
  const s=current();s.mandateRevision='124';const proposeResearchPlan=vi.fn();
  expect(await createResearchSupervisor({researchSupervisionContext:vi.fn().mockResolvedValue(s),proposeResearchPlan})(event())).toMatchObject({kind:'review'});expect(proposeResearchPlan).not.toHaveBeenCalled();
 });
});

it('returns actionable saved-brief review only after cached reuse declines, without proposing research or implying provider uncertainty',async()=>{const state={...current(),researchReadiness:{issues:['Confirm geography or a testing assumption before discovery.','Confirm subsectors or a testing assumption before discovery.'],briefPath:'/mandates/10000000-0000-4000-8000-000000000001'}},proposeResearchPlan=vi.fn().mockResolvedValue({}),reuseCached=vi.fn().mockResolvedValue(false),input=event();const result=await createResearchSupervisor({researchSupervisionContext:vi.fn().mockResolvedValue(state),proposeResearchPlan},{reuseCached})(input);expect(result).toEqual({kind:'review',message:expect.stringContaining('Confirm the saved research brief before company discovery.')});expect(result).toHaveProperty('message',expect.stringContaining('geography'));expect(result).toHaveProperty('message',expect.stringContaining('subsectors'));expect(result).toHaveProperty('message',expect.not.stringContaining('provider outcome'));expect(proposeResearchPlan).not.toHaveBeenCalled();expect(reuseCached).toHaveBeenCalledOnce();});
it('retains cached manual-contact reuse without auto-confirming an unconfirmed research brief',async()=>{const state={...current(),researchReadiness:{issues:['Confirm geography before discovery.'],briefPath:'/mandates/10000000-0000-4000-8000-000000000001'}},proposeResearchPlan=vi.fn(),reuseCached=vi.fn().mockResolvedValue(true);expect(await createResearchSupervisor({researchSupervisionContext:vi.fn().mockResolvedValue(state),proposeResearchPlan},{reuseCached})(event())).toEqual({kind:'complete'});expect(proposeResearchPlan).not.toHaveBeenCalled();expect(state.researchReadiness.issues).toHaveLength(1);});
it('does not disguise unrelated proposal or database failures as a known brief-readiness review',async()=>{const problem=new Error('Unknown committed boundary'),proposeResearchPlan=vi.fn().mockRejectedValue(problem);await expect(createResearchSupervisor({researchSupervisionContext:vi.fn().mockResolvedValue({...current(),researchReadiness:{issues:[],briefPath:'/mandates/10000000-0000-4000-8000-000000000001'}}),proposeResearchPlan})(event())).rejects.toBe(problem);});

it('reports a configured unsupported engine before proposing research instead of silently substituting Firmable-only',async()=>{
 const message='Native research is blocked for hybrid-firmable-v1: web/search/page/AI physical-attempt accounting is not implemented. No alternate engine was selected.';
 const proposeResearchPlan=vi.fn(),state={...current(),researchEngine:{kind:'blocked',productionPipeline:'hybrid-firmable-v1',missing:['native_web_search_accounting'],message}};
 const result=await createResearchSupervisor({researchSupervisionContext:vi.fn().mockResolvedValue(state),proposeResearchPlan})(event());
 expect(result).toEqual({kind:'review',message});expect(proposeResearchPlan).not.toHaveBeenCalled();
});

it('stops at existing review outcome when cached-read readiness is unavailable instead of proposing new paid research',async()=>{const proposeResearchPlan=vi.fn(),reuseCached=vi.fn().mockRejectedValue(new AgentReadinessUnavailableError({code:'55P03'}));expect(await createResearchSupervisor({researchSupervisionContext:vi.fn().mockResolvedValue(current()),proposeResearchPlan},{reuseCached})(event())).toEqual({kind:'review',message:expect.stringContaining('Company readiness is temporarily unavailable')});expect(proposeResearchPlan).not.toHaveBeenCalled();expect(reuseCached).toHaveBeenCalledOnce();});

it('recovers a saved submission before legacy readiness or a duplicate native approval plan',async()=>{
 const proposeResearchPlan=vi.fn(),reuseCached=vi.fn(),initialResearch=vi.fn().mockResolvedValue(true),state={...current(),researchReadiness:{issues:['Confirm geography before research.'],briefPath:'/brief'}};
 expect(await createResearchSupervisor({researchSupervisionContext:vi.fn().mockResolvedValue(state),proposeResearchPlan},{initialResearch,reuseCached})(event())).toEqual({kind:'complete'});
 expect(initialResearch).toHaveBeenCalledOnce();expect(reuseCached).not.toHaveBeenCalled();expect(proposeResearchPlan).not.toHaveBeenCalled();
});
it('never runs submission recovery for stale or paused supervision',async()=>{
 const initialResearch=vi.fn();await createResearchSupervisor({researchSupervisionContext:vi.fn().mockResolvedValue({...current(),responsibility:{...current().responsibility,state:'paused'}}),proposeResearchPlan:vi.fn()},{initialResearch})(event());expect(initialResearch).not.toHaveBeenCalled();
});
