import{beforeEach,expect,it,vi}from'vitest';
import type{AcquireCoverageProjectorOptions}from'./communications-coverage-projector';
import type{CommunicationReplyConsumerOptions}from'./communications-reply-consumer';
vi.mock('server-only',()=>({}));
const ports=vi.hoisted(()=>({project:vi.fn(),apply:vi.fn(),coverage:undefined as AcquireCoverageProjectorOptions|undefined,consumer:undefined as CommunicationReplyConsumerOptions|undefined}));
vi.mock('./communications-coverage-projector',()=>({createAcquireCoverageProjector:(options:AcquireCoverageProjectorOptions)=>{ports.coverage=options;return{project:ports.project};}}));
vi.mock('./communications-reply-consumer',()=>({createCommunicationReplyConsumer:(options:CommunicationReplyConsumerOptions)=>{ports.consumer=options;return{apply:ports.apply};}}));
import{createHostedDemoProofBridge}from'./hosted-demo-proof-bridge';
import{readHostedDemoCommunicationsDescriptor}from'./hosted-demo-communications-environment';
import{hostedProofDigest}from'../../communications/packages/core/src/hosted-proof-sessions';
const binding={applicationId:'acquire',tenantId:'org',ownerId:'owner',connectionId:'connection',accountId:'account',generation:1,channel:'whatsapp',platform:'whatsapp',backend:'unipile'}as const;
const d={version:1,mode:'hosted-demo',runId:'hosted-demo-example',integrationId:'sim-hosted-demo-example',configurationReference:'sim-hosted-demo-example-v1',applicationOrigin:'https://app.example.invalid',serviceOrigin:'https://demo.example.invalid',setupOrigin:'https://demo.example.invalid',actor:{applicationId:'acquire',tenantId:'org',ownerId:'owner'},capabilities:{dynamicRecipients:true,recipientContextLookup:true,remoteApplicationAuthority:true,durableEvents:true},bindings:[binding]};
const descriptor=readHostedDemoCommunicationsDescriptor({NODE_ENV:'production',APP_URL:d.applicationOrigin,AGENT_HOSTED_DEMO_COMMUNICATIONS_ENABLED:'true',AGENT_HOSTED_DEMO_COMMUNICATIONS_DESCRIPTOR_JSON:JSON.stringify(d)});
function fixtures(){const now=new Date().toISOString(),subscriberId='acquire-hosted-demo-replies',proof={coverage:{binding,scope:'account',from:'1970-01-01T00:00:00.000Z',through:now,observedAt:now,complete:true,initialSyncComplete:true,invalidated:false},scopeDigest:'b'.repeat(64),serviceRevision:'3',subscriberId,sessionId:'x'.repeat(43),expiresAt:new Date(Date.now()+15000).toISOString()},event={binding,subscriberId,eventId:'1',sourceNamespace:'reply_review/v1',sourceEventKey:'c'.repeat(64),payload:{outcome:{kind:'review',code:'protocol'},fingerprint:'d'.repeat(64),receivedAt:now},sessionId:'y'.repeat(43),expiresAt:proof.expiresAt}as const;const serviceRequest=vi.fn(async()=>({verified:true})),localBinding=vi.fn(async()=>'10000000-0000-4000-8000-000000000001');return{proof,event,serviceRequest,localBinding,bridge:createHostedDemoProofBridge({descriptor,pool:{}as never,codec:{}as never,subscriberId,serviceRequest,localBinding})};}
beforeEach(()=>{vi.clearAllMocks();ports.coverage=undefined;ports.consumer=undefined;});
it('projects through the normal held coverage projector with full original proof revalidation before commit',async()=>{
 const f=fixtures(),committed=vi.fn();ports.project.mockImplementation(async query=>ports.coverage!.withCoverage(query,async held=>{expect(held.coverage).toEqual(f.proof.coverage);await held.revalidate();committed();}));await f.bridge.projectCoverage(f.proof,new AbortController().signal);expect(committed).toHaveBeenCalledOnce();expect(f.serviceRequest).toHaveBeenCalledTimes(2);
 expect(f.serviceRequest).toHaveBeenCalledWith('/v1/hosted-demo/coverage/revalidate',{proofDigest:hostedProofDigest(f.proof),sessionId:f.proof.sessionId,binding,scopeDigest:f.proof.scopeDigest,serviceRevision:f.proof.serviceRevision},expect.any(AbortSignal));
});
it('does not produce app projection credit or event acknowledgement when original live service evidence refuses verification',async()=>{
 const f=fixtures(),committed=vi.fn();f.serviceRequest.mockResolvedValue({verified:false});ports.project.mockImplementation(async query=>ports.coverage!.withCoverage(query,async()=>{committed();}));await expect(f.bridge.projectCoverage(f.proof,new AbortController().signal)).rejects.toThrow('Hosted proof unavailable');expect(committed).not.toHaveBeenCalled();
 ports.apply.mockImplementation(async(input,signal)=>{if(!await ports.consumer!.authenticateDelivery(input,signal))throw Error('Rejected');return{status:'applied',decision:'review'};});await expect(f.bridge.deliverEvents(f.event,new AbortController().signal)).rejects.toThrow('Hosted proof unavailable');
});
it('uses the normal reply consumer and returns exact service ACK metadata only after the application transaction resolves',async()=>{
 const f=fixtures();ports.apply.mockImplementation(async(input,signal)=>{expect(await ports.consumer!.authenticateDelivery(input,signal)).toBe(true);return{status:'applied',decision:'review'};});expect(await f.bridge.deliverEvents(f.event,new AbortController().signal)).toEqual({binding,subscriberId:f.event.subscriberId,eventId:'1',fingerprint:f.event.payload.fingerprint,status:'committed'});
 expect(f.serviceRequest).toHaveBeenCalledWith('/v1/hosted-demo/events/revalidate',{proofDigest:hostedProofDigest(f.event),sessionId:f.event.sessionId,binding,subscriberId:f.event.subscriberId,eventId:f.event.eventId,fingerprint:f.event.payload.fingerprint},expect.any(AbortSignal));expect(ports.consumer!.resolveIdentity).toBeTypeOf('function');expect(ports.consumer!.resolveUnrelated).toBeTypeOf('function');
});
it('reports service revalidation separately from projector refusal without leaking its error',async()=>{
 vi.stubEnv('AGENT_VERBOSE_LOGGING','true');const log=vi.spyOn(console,'warn').mockImplementation(()=>{}),f=fixtures();f.serviceRequest.mockRejectedValue(Error('PRIVATE callback details'));
 ports.project.mockImplementation(async query=>ports.coverage!.withCoverage(query,async()=>{}));
 try{await expect(f.bridge.projectCoverage(f.proof,new AbortController().signal)).rejects.toThrow('Hosted proof unavailable');expect(log).toHaveBeenCalledWith('hosted-demo-failure',JSON.stringify({boundary:'bridge.revalidate'}));expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE');}finally{log.mockRestore();vi.unstubAllEnvs();}
});
it('distinguishes an authenticated verified:false response from transport failure',async()=>{
 vi.stubEnv('AGENT_VERBOSE_LOGGING','true');const log=vi.spyOn(console,'warn').mockImplementation(()=>{}),f=fixtures();f.serviceRequest.mockResolvedValue({verified:false});ports.project.mockImplementation(async query=>ports.coverage!.withCoverage(query,async()=>{}));
 try{await expect(f.bridge.projectCoverage(f.proof,new AbortController().signal)).rejects.toThrow('Hosted proof unavailable');expect(log).toHaveBeenCalledWith('hosted-demo-revalidation',JSON.stringify({boundary:'coverage.revalidate',outcome:'verification_refused'}));}finally{log.mockRestore();vi.unstubAllEnvs();}
});
