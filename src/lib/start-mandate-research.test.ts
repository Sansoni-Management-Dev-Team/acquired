import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyBrief } from '@/domain/acquisition';
const mocks = vi.hoisted(() => ({ enabled:vi.fn(), mandate:vi.fn(), scope:vi.fn(), create:vi.fn(), worker:vi.fn(), ready:vi.fn(), active:vi.fn(), org:vi.fn() }));
vi.mock('@/db/client',()=>({requireDb:()=>({select:()=>({from:()=>({where:()=>({limit:async()=>[{metadata:JSON.stringify({researchSettings:{defaultTargetBusinesses:20}})}]})})})})}));
vi.mock('@/db/acquisition-repository',()=>({AcquisitionRepository:class {constructor(org:string){mocks.org(org);}getMandate=mocks.mandate;}}));
vi.mock('@/db/research-repository',()=>({MandateResearchRevisionError:class extends Error{},ResearchRepository:class {constructor(org:string){mocks.org(org);}create=mocks.create;concurrentResearchReady=mocks.ready;hasOtherActive=mocks.active;}}));
vi.mock('@/lib/research-service',()=>({researchEnabled:mocks.enabled,researchWorker:mocks.worker}));
vi.mock('@/lib/brief-research',()=>({generateBriefResearchScope:mocks.scope,briefResearchGeography:()=> 'Australia',briefResearchSources:()=>['https://supplier.example.com/']}));
import { startMandateResearch } from './start-mandate-research';
import { MandateResearchRevisionError } from '@/db/research-repository';
const mandateId='00000000-0000-4000-8000-000000000001',requestId='00000000-0000-4000-8000-000000000002';
const actor={organizationId:'org-owned',userId:'user-owned'};
beforeEach(()=>{
 vi.resetAllMocks();vi.stubEnv('LOCAL_DEVELOPMENT','true');vi.stubEnv('RESEARCH_PIPELINE_DESIGN','hybrid-firmable-v1');
 mocks.enabled.mockReturnValue(true);mocks.mandate.mockResolvedValue({id:mandateId,brief:emptyBrief(),revision:'17'});mocks.scope.mockResolvedValue('Commercial refrigeration');
 mocks.create.mockResolvedValue({id:requestId,status:'queued'});mocks.ready.mockResolvedValue(true);mocks.active.mockResolvedValue(false);
});
describe('shared mandate research application action',()=>{
 it('launches finite company work without an elapsed-run cancellation deadline',async()=>{
  await startMandateResearch(actor,mandateId,{requestId,fromBrief:true});
  const config=mocks.create.mock.calls[0][3];
  expect(config.automaticDeadline).toBeUndefined();expect(config.completionPolicy).toBe('work-items');
 });
 it('starts saved-brief research for the trusted actor without an HTTP or session dependency',async()=>{
  expect(await startMandateResearch(actor,mandateId,{requestId,fromBrief:true})).toEqual({status:202,body:{jobId:requestId}});
  expect(mocks.create).toHaveBeenCalledWith(requestId,mandateId,actor.userId,expect.objectContaining({researchRunId:requestId,targetBusinesses:20,includeCompanyPeople:true,includePhones:false,findPeople:false,companyDiscoveryPolicy:expect.objectContaining({version:5})}));
  expect(mocks.org.mock.calls.every(([org])=>org===actor.organizationId)).toBe(true);
  expect(mocks.worker).toHaveBeenCalledWith(`/jobs/${requestId}`,'POST');
 });
 it('rejects a changed submission revision before generating a scope or creating a job',async()=>{
  expect(await startMandateResearch(actor,mandateId,{requestId,fromBrief:true},{expectedMandateRevision:'16'})).toEqual({status:409,body:{error:'The mandate changed before research started. Submit the current brief again.'}});
  expect(mocks.scope).not.toHaveBeenCalled();expect(mocks.create).not.toHaveBeenCalled();expect(mocks.worker).not.toHaveBeenCalled();
 });
 it('rechecks the submitted revision after asynchronous scope preparation',async()=>{
  mocks.mandate.mockResolvedValueOnce({id:mandateId,brief:emptyBrief(),revision:'17'}).mockResolvedValueOnce({id:mandateId,brief:emptyBrief(),revision:'18'});
  expect((await startMandateResearch(actor,mandateId,{requestId,fromBrief:true},{expectedMandateRevision:'17'})).status).toBe(409);
  expect(mocks.scope).toHaveBeenCalledOnce();expect(mocks.create).not.toHaveBeenCalled();expect(mocks.worker).not.toHaveBeenCalled();
 });
 it('forwards the exact submitted revision to atomic insertion and returns its conflict without dispatch',async()=>{
  mocks.create.mockRejectedValue(new MandateResearchRevisionError());
  expect((await startMandateResearch(actor,mandateId,{requestId,fromBrief:true},{expectedMandateRevision:'17'})).status).toBe(409);
  expect(mocks.create).toHaveBeenCalledWith(requestId,mandateId,actor.userId,expect.any(Object),{expectedMandateRevision:'17'});
  expect(mocks.worker).not.toHaveBeenCalled();
 });
 it('retains the saved job identity when dispatch is uncertain',async()=>{
  mocks.worker.mockRejectedValue(Error('private transport failure'));
  expect(await startMandateResearch(actor,mandateId,{requestId,fromBrief:true})).toEqual({status:202,body:{jobId:requestId,message:'Job saved. Dispatch uncertain; retry this job to reconnect without duplicating it.'}});
  expect(mocks.create).toHaveBeenCalledOnce();
 });
 it('retains the native continuation review boundary for direct application callers',async()=>{
  expect((await startMandateResearch(actor,mandateId,{requestId,fromBrief:true,companyContinuation:{}})).status).toBe(400);
  expect(mocks.mandate).not.toHaveBeenCalled();expect(mocks.create).not.toHaveBeenCalled();expect(mocks.worker).not.toHaveBeenCalled();
 });
});
