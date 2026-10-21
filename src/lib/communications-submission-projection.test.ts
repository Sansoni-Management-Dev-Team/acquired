import {beforeEach,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const f=vi.hoisted(()=>({configured:vi.fn(),client:vi.fn(),pool:vi.fn(),admission:vi.fn(),construct:vi.fn(),capture:vi.fn(),materialize:vi.fn()}));
vi.mock('@/db/campaign-client',()=>({campaignSqlPool:f.pool}));
vi.mock('./communications-configuration',()=>({configuredAcquireCommunicationsForBinding:f.configured}));
vi.mock('./communications-client',()=>({actorCommunicationsClient:f.client}));
vi.mock('./communications-bindings',()=>({resolveRecordedApplicationConnection:vi.fn()}));
vi.mock('./communications-submission-ledger',()=>({CommunicationsSubmissionLedger:class{constructor(input:unknown){f.construct(input);}capture=f.capture;materializeDraft=f.materialize;}}));
import{captureOriginalSubmission}from'./communications-submission-projection';
const actor={organizationId:'org',userId:'user'},binding={applicationId:'acquire',tenantId:'org',ownerId:'user',connectionId:'original',accountId:'physical-original',generation:1,channel:'email' as const,platform:'gmail' as const,backend:'unipile' as const};
beforeEach(()=>{vi.clearAllMocks();f.configured.mockResolvedValue({applicationCodec:'original-codec',host:{admission:f.admission}});f.admission.mockResolvedValue('original-admission');f.client.mockResolvedValue('binding-routed-client');f.pool.mockReturnValue('private-pool');});
it.each(['agent','campaign','draft'] as const)('captures %s through binding-resolved original SDK authority without taking a caller receipt',async sourceKind=>{f.capture.mockResolvedValue({status:'submitted',effect:'message',providerReference:'original-message',submittedAt:'2026-10-17T00:00:00Z'});await captureOriginalSubmission(actor,{bindingId:'original-binding',binding,sourceKind,sourceId:'original-source'},{effect:'message',providerReference:'original-message',submittedAt:'2026-10-17T00:00:00.000Z'});expect(f.configured).toHaveBeenCalledWith(actor,binding);expect(f.construct).toHaveBeenCalledWith({actor,bindingId:'original-binding',binding,pool:'private-pool',codec:'original-codec',admission:'original-admission',client:'binding-routed-client'});expect(f.capture).toHaveBeenCalledWith({sourceKind,sourceId:'original-source'});expect(f.materialize).not.toHaveBeenCalled();});
it.each([{status:'unconfirmed'},{status:'submitted',effect:'invitation',providerReference:'original-message',submittedAt:'2026-10-17T00:00:00Z'},{status:'submitted',effect:'message',providerReference:'other',submittedAt:'2026-10-17T00:00:00Z'},{status:'submitted',effect:'message',providerReference:'original-message',submittedAt:'2026-10-17T00:00:01Z'}])('does not promote mismatched original fact %#',async fact=>{f.capture.mockResolvedValue(fact);await expect(captureOriginalSubmission(actor,{bindingId:'binding',binding,sourceKind:'agent',sourceId:'original'},{effect:'message',providerReference:'original-message',submittedAt:'2026-10-17T00:00:00Z'})).rejects.toThrow('Exact original submitted outcome required');});

it('uses explicit trusted same-operation ports without invoking configured singleton or substituting expected facts',async()=>{
 const ports={pool:{connect:vi.fn()},codec:'scoped-codec',admission:'scoped-admission',client:'scoped-client',businessClock:{now:()=>Date.parse('2031-01-01T00:00:00.000Z')}};
 f.capture.mockResolvedValue({status:'submitted',effect:'message',providerReference:'original-message',submittedAt:'2031-01-01T00:00:00.000Z'});
 await captureOriginalSubmission(actor,{bindingId:'original-binding',binding,sourceKind:'agent',sourceId:'original-source'},{effect:'message',providerReference:'original-message',submittedAt:'2031-01-01T00:00:00.000Z'},ports as never);
 expect(f.construct).toHaveBeenCalledWith({...ports,actor,bindingId:'original-binding',binding});expect(f.configured).not.toHaveBeenCalled();expect(f.capture).toHaveBeenCalledWith({sourceKind:'agent',sourceId:'original-source'});
});
