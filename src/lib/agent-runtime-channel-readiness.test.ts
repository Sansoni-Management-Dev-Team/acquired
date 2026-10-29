import type{ConnectionBinding}from'../../communications/packages/contracts/src';
import{it,expect,vi}from'vitest';
vi.mock('server-only',()=>({}));
import{createAgentChannelReadiness}from'./agent-runtime-channel-readiness';
const actor={organizationId:'org',userId:'owner'},binding={applicationId:'acquire',tenantId:'org',ownerId:'owner',connectionId:'c',accountId:'a',generation:1,channel:'email' as const,platform:'gmail' as const,backend:'unipile' as const},channel={channel:'email',bindingId:'owned',generationDigest:'digest',ready:false,reason:'recorded_account_requires_live_check'};
it('verifies only exact owned recorded bindings and caches service status for30 seconds',async()=>{let now=1;const load=vi.fn(async()=>binding),status=vi.fn(async()=>({binding,status:'connected',capabilities:{messaging:{send:true},events:{read:true,history:true}}}));const read=createAgentChannelReadiness({loadBinding:load,connectionStatus:status,now:()=>now});expect((await read(actor,[channel]))[0]).toMatchObject({ready:true,readiness:'connected'});await read(actor,[channel]);expect(load).toHaveBeenCalledTimes(2);expect(status).toHaveBeenCalledTimes(1);now+=30001;await read(actor,[channel]);expect(status).toHaveBeenCalledTimes(2);});
it('fails closed for missing ownership, mismatched generation, capabilities and unavailable status',async()=>{for(const result of [undefined,{...binding,generation:2}]){const status=vi.fn(async()=>({binding,status:'connected',capabilities:{messaging:{send:true},events:{read:true,history:true}}})),read=createAgentChannelReadiness({loadBinding:async()=>result,connectionStatus:status});const rows=await read(actor,[channel]);expect(rows[0].ready).toBe(false);}const read=createAgentChannelReadiness({loadBinding:async()=>binding,connectionStatus:async()=>{throw Error('PRIVATE remote body');}});expect((await read(actor,[channel]))[0]).toMatchObject({ready:false,readiness:'unavailable'});expect(JSON.stringify(await read(actor,[channel]))).not.toContain('PRIVATE');});
it('does not turn connected into verified full conversation history or default-account selection',async()=>{const read=createAgentChannelReadiness({loadBinding:async()=>binding,connectionStatus:async()=>({binding,status:'connected',capabilities:{messaging:{send:true},events:{read:true,history:false}}})});expect((await read(actor,[channel]))[0]).toMatchObject({ready:false,readiness:'verification_required'});});
it('preserves explicit sender selection when owned accounts exist instead of reporting a missing connection',async()=>{
 const load=vi.fn(async()=>binding),status=vi.fn(async()=>{throw Error('No account may be selected implicitly');}),read=createAgentChannelReadiness({loadBinding:load,connectionStatus:status});
 const rows=await read(actor,[{...channel,bindingId:null,generationDigest:null,reason:'choose_recorded_account'}]);
 expect(rows).toEqual([{...channel,bindingId:null,generationDigest:null,ready:false,readiness:'setup_required',reason:'choose_recorded_account'}]);expect(load).not.toHaveBeenCalled();expect(status).not.toHaveBeenCalled();
 const missing=await read(actor,[{...channel,bindingId:null,reason:'recorded_account_missing'}]);expect(missing[0]).toMatchObject({ready:false,readiness:'setup_required',reason:'recorded_account_missing'});
});
it('loads the three owned bindings once and creates one status client per uncached request',async()=>{
 const bindings=[binding,{...binding,channel:'whatsapp' as const,platform:'whatsapp' as const},{...binding,channel:'linkedin' as const,platform:'linkedin' as const}];
 const channels=bindings.map((b,i)=>({...channel,channel:b.channel,bindingId:String(i)}));
 const loadBinding=vi.fn(async()=>{throw Error('Per-channel database fan-out');});
 const loadBindings=vi.fn(async()=>new Map(bindings.map((b,i)=>[String(i),b])));
 const status=vi.fn(async(b:ConnectionBinding)=>({binding:b,status:'connected',capabilities:{messaging:{send:true},events:{read:true,history:true}}}));
 const connectionStatusForActor=vi.fn(async()=>status);
 const read=createAgentChannelReadiness({loadBinding,loadBindings,connectionStatus:vi.fn(),connectionStatusForActor});
 expect((await read(actor,channels)).every(row=>row.ready)).toBe(true);expect(loadBindings).toHaveBeenCalledOnce();expect(loadBinding).not.toHaveBeenCalled();expect(connectionStatusForActor).toHaveBeenCalledOnce();expect(status).toHaveBeenCalledTimes(3);
 await read(actor,channels);expect(loadBindings).toHaveBeenCalledTimes(2);expect(connectionStatusForActor).toHaveBeenCalledOnce();
});
it('rejects foreign batched bindings and never creates a provider client when binding reads fail',async()=>{
 const client=vi.fn();
 const foreign=createAgentChannelReadiness({loadBindings:async()=>new Map([['owned',{...binding,ownerId:'another-user'}]]),connectionStatusForActor:client});
 expect((await foreign(actor,[channel]))[0]).toMatchObject({ready:false,readiness:'verification_required'});
 const failed=createAgentChannelReadiness({loadBindings:async()=>{throw Error('private database details');},connectionStatusForActor:client});
 expect((await failed(actor,[channel]))[0]).toMatchObject({ready:false,readiness:'unavailable'});expect(client).not.toHaveBeenCalled();
});
