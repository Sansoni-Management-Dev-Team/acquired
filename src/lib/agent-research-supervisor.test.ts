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
