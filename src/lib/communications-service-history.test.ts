import {afterEach,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));vi.mock('../../communications/services/api/src/service',()=>({createCommunicationsService:()=>({server:{},close:vi.fn()})}));
import {createAcquireCommunicationsService} from './communications-service';
const scope={applicationId:'acquire',tenantId:'tenant',ownerId:'owner'},binding={...scope,connectionId:'connection',accountId:'account',generation:1,channel:'email',platform:'gmail',backend:'unipile'};
const now=Date.parse('2026-10-17T12:00:00Z');
function fixture(){
 vi.spyOn(Date,'now').mockReturnValue(now);let persisted=false;
 const refresh=vi.fn(async()=>{persisted=true;return{status:'complete'};}),coverage=vi.fn(async()=>null as unknown),history=vi.fn(async()=>({repository:{coverage},refresh}));
 const list=vi.fn(async()=>[{binding,active:true,status:'connected'}]),renewScope=vi.fn(async()=>true),consumePending=vi.fn(async()=>{expect(persisted||refresh.mock.calls.length===0).toBe(true);});
 const configured={unipile:{store:{preflight:vi.fn(async()=>true),list}},host:{serverDependencies:{},history,currentSubjects:vi.fn(async()=>[scope]),renewScope,consumePending,pendingReplyBindings:vi.fn(async()=>[]),recordPendingReplyBinding:vi.fn(),createWebhooks:()=>({ingress:{},runOne:vi.fn(async()=>({status:'idle'}))})}};
 return{configured,refresh,coverage,history,list,renewScope,consumePending};
}
afterEach(()=>vi.restoreAllMocks());
it('starts and awaits persisted account history for connected email independently of browser/default app binding',async()=>{
 const f=fixture(),service=await createAcquireCommunicationsService(f.configured as never);await service.tick();
 expect(f.refresh).toHaveBeenCalledOnce();expect(f.refresh).toHaveBeenCalledWith({binding,scope:'account',since:new Date(now-300000).toISOString(),cursor:null,refresh:true},{signal:expect.any(AbortSignal)});expect(f.consumePending).toHaveBeenCalledWith(binding,20);expect(f.history).toHaveBeenCalledWith(binding);
});
it('does not refresh revoked subjects, inactive/disconnected accounts or social channels',async()=>{
 const f=fixture();f.list.mockResolvedValue([{binding,active:false,status:'connected'},{binding,active:true,status:'disconnected'},{binding:{...binding,channel:'linkedin',platform:'linkedin'},active:true,status:'connected'}]);let service=await createAcquireCommunicationsService(f.configured as never);await service.tick();expect(f.history).not.toHaveBeenCalled();
 f.renewScope.mockResolvedValue(false);service=await createAcquireCommunicationsService(f.configured as never);await service.tick();expect(f.list).toHaveBeenCalledTimes(1);expect(f.refresh).not.toHaveBeenCalled();
});
it('reuses only fresh exact complete uninvalidated account coverage',async()=>{
 const f=fixture();f.coverage.mockResolvedValue({binding,scope:'account',from:new Date(now-300000).toISOString(),through:new Date(now).toISOString(),observedAt:new Date(now).toISOString(),complete:true,initialSyncComplete:true,invalidated:false});const service=await createAcquireCommunicationsService(f.configured as never);await service.tick();expect(f.refresh).not.toHaveBeenCalled();expect(f.consumePending).toHaveBeenCalledOnce();
 f.coverage.mockResolvedValue({binding,scope:'account',complete:true,initialSyncComplete:true,invalidated:true});await service.tick();expect(f.refresh).toHaveBeenCalledOnce();
});
it('refreshes at most one account each tick, backs off failures/pending for60seconds and never overlaps ticks',async()=>{
 const f=fixture();f.list.mockResolvedValue([{binding,active:true,status:'connected'},{binding:{...binding,connectionId:'second',accountId:'second'},active:true,status:'connected'}]);f.refresh.mockRejectedValueOnce(Error('synthetic failure'));const service=await createAcquireCommunicationsService(f.configured as never);await service.tick();expect(f.refresh).toHaveBeenCalledTimes(1);await service.tick();expect(f.refresh).toHaveBeenCalledTimes(2);await service.tick();expect(f.refresh).toHaveBeenCalledTimes(2);
 vi.spyOn(Date,'now').mockReturnValue(now+60001);let finish!:(value:unknown)=>void;f.refresh.mockImplementationOnce(()=>new Promise(resolve=>finish=resolve) as never);const first=service.tick();await vi.waitFor(()=>expect(f.refresh).toHaveBeenCalledTimes(3));await service.tick();expect(f.refresh).toHaveBeenCalledTimes(3);finish({status:'pending'});await first;
});
it('retains pending delivery when no app binding exists and retries consume after stored refresh without restarting providerwork',async()=>{
 const f=fixture();f.consumePending.mockRejectedValueOnce(Error('No saved local binding'));const service=await createAcquireCommunicationsService(f.configured as never);await service.tick();await service.tick();expect(f.refresh).toHaveBeenCalledOnce();expect(f.consumePending).toHaveBeenCalledTimes(2);
});
it('does not trust coverage for another recorded binding and backs off its failure without a provider refresh',async()=>{
 const f=fixture();f.coverage.mockResolvedValue({binding:{...binding,accountId:'foreign-account'},scope:'account',complete:true,initialSyncComplete:true,invalidated:false});const service=await createAcquireCommunicationsService(f.configured as never);await service.tick();await service.tick();expect(f.refresh).not.toHaveBeenCalled();expect(f.coverage).toHaveBeenCalledOnce();expect(f.consumePending).toHaveBeenCalledTimes(2);
});
it('drains a retained original integration generation before current history without provider calls or a fake ACK',async()=>{
 const f=fixture(),retained={...binding,connectionId:'retired-original',accountId:'original-account',generation:2};
 f.list.mockResolvedValue([]);const pendingReplyBindings=vi.fn(async()=>[retained]),recordPendingReplyBinding=vi.fn(async()=> 'recorded-original');
 const service=await createAcquireCommunicationsService({...f.configured,host:{...f.configured.host,pendingReplyBindings,recordPendingReplyBinding}}as never);
 await service.tick();expect(pendingReplyBindings).toHaveBeenCalledWith(scope,10);expect(recordPendingReplyBinding).toHaveBeenCalledWith(retained);expect(f.consumePending).toHaveBeenCalledWith(retained,20);expect(f.history).not.toHaveBeenCalled();expect(f.refresh).not.toHaveBeenCalled();
});
it('does not consume or acknowledge retained work if original binding registration is unavailable',async()=>{const f=fixture();f.list.mockResolvedValue([]);const service=await createAcquireCommunicationsService({...f.configured,host:{...f.configured.host,pendingReplyBindings:vi.fn(async()=>[binding]),recordPendingReplyBinding:vi.fn(async()=>{throw Error('Original scope unavailable');})}}as never);await service.tick();expect(f.consumePending).not.toHaveBeenCalled();expect(f.history).not.toHaveBeenCalled();});
it('bounds retained binding consumption per tick even when a host fixture returns an oversized list',async()=>{const f=fixture();f.list.mockResolvedValue([]);const recordPendingReplyBinding=vi.fn(async()=> 'original'),service=await createAcquireCommunicationsService({...f.configured,host:{...f.configured.host,pendingReplyBindings:vi.fn(async()=>Array.from({length:50},(_,i)=>({...binding,connectionId:'original-'+i}))),recordPendingReplyBinding}}as never);await service.tick();expect(recordPendingReplyBinding).toHaveBeenCalledTimes(20);expect(f.consumePending).toHaveBeenCalledTimes(20);expect(f.history).not.toHaveBeenCalled();});

it('advances history policy time while retaining real refresh cooldown and operational abort bounds',async()=>{
 const f=fixture();let business=now+86400000*5;const configured={...f.configured,businessScope:scope,options:{businessClock:{now:()=>business}}};
 const service=await createAcquireCommunicationsService(configured as never);await service.tick([scope]);
 expect(f.refresh).toHaveBeenCalledWith(expect.objectContaining({since:new Date(business-300000).toISOString()}),{signal:expect.any(AbortSignal)});
 business+=86400000*2;await service.tick([scope]);expect(f.refresh).toHaveBeenCalledOnce();
 vi.spyOn(Date,'now').mockReturnValue(now+60001);await service.tick([scope]);expect(f.refresh).toHaveBeenCalledTimes(2);expect(f.refresh).toHaveBeenLastCalledWith(expect.objectContaining({since:new Date(business-300000).toISOString()}),{signal:expect.any(AbortSignal)});
});

it('explicit subjects avoid discovery and still renew each selected original subject before listing work',async()=>{
 const f=fixture(),service=await createAcquireCommunicationsService(f.configured as never);await service.tick([scope]);
 expect(f.configured.host.currentSubjects).not.toHaveBeenCalled();expect(f.renewScope).toHaveBeenCalledWith(scope);expect(f.list).toHaveBeenCalledWith(scope);
});
it.each(['foreign','missing-array','missing-bound-scope'] as const)('selected clock tick rejects %s before authorization, discovery or provider work',async variant=>{
 const f=fixture(),configured={...f.configured,options:{businessClock:{now:()=>now}},...(variant==='missing-bound-scope'?{}:{businessScope:scope})},service=await createAcquireCommunicationsService(configured as never);
 await expect(variant==='missing-array'?service.tick():service.tick([{...scope,...(variant==='foreign'?{ownerId:'foreign'}:{})}])).rejects.toThrow('Exact business clock subject required');
 expect(f.configured.host.currentSubjects).not.toHaveBeenCalled();expect(f.renewScope).not.toHaveBeenCalled();expect(f.list).not.toHaveBeenCalled();expect(f.history).not.toHaveBeenCalled();
});
