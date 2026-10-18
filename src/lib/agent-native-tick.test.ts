import {expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {runNativeTickWithPorts} from './agent-native-tick';
const scopes=[{organizationId:'org-a',userId:'owner-a'},{organizationId:'org-b',userId:'owner-b'}];
it('enumerates only server-owned due scopes and processes a bounded event without browser state',async()=>{
 const list=vi.fn().mockResolvedValue(scopes),process=vi.fn().mockResolvedValueOnce('idle').mockResolvedValueOnce('complete');
 expect(await runNativeTickWithPorts({enabled:true,listScopes:list,processScope:process})).toEqual({enabled:true,processed:1,outcome:'complete'});
 expect(list).toHaveBeenCalledWith(10);expect(process).toHaveBeenCalledTimes(2);expect(process.mock.calls[1][0]).toEqual(scopes[1]);
});
it('does not enumerate or execute native work while the independent feature flag is off',async()=>{
 const list=vi.fn(),process=vi.fn();expect(await runNativeTickWithPorts({enabled:false,listScopes:list,processScope:process})).toEqual({enabled:false,processed:0});expect(list).not.toHaveBeenCalled();expect(process).not.toHaveBeenCalled();
});
it('stops after one claimed outcome and bounds untrusted scope enumeration',async()=>{
 const process=vi.fn().mockResolvedValue('review');await runNativeTickWithPorts({enabled:true,listScopes:async()=>scopes,processScope:process});expect(process).toHaveBeenCalledOnce();
 await expect(runNativeTickWithPorts({enabled:true,listScopes:async()=>Array.from({length:11},()=>scopes[0]),processScope:process})).rejects.toThrow();
});
it('keeps a server-owned exact mandate restriction on both scope enumeration and per-actor processing',async()=>{
 const mandateId='00000000-0000-4000-8000-000000000037',list=vi.fn().mockResolvedValue([scopes[0]]),process=vi.fn().mockResolvedValue('complete');
 await runNativeTickWithPorts({enabled:true,mandateId,listScopes:list,processScope:process} as never);expect(list).toHaveBeenCalledWith(10,mandateId);expect(process).toHaveBeenCalledWith(scopes[0],mandateId);
});
it('fails closed before enumeration for a malformed or missing mandatory server scope',async()=>{
 for(const config of [{mandateId:''},{mandateId:'not-a-uuid'},{requireMandateScope:true}]){const list=vi.fn(),process=vi.fn();await expect(runNativeTickWithPorts({enabled:true,...config,listScopes:list,processScope:process} as never)).rejects.toThrow();expect(list).not.toHaveBeenCalled();expect(process).not.toHaveBeenCalled();}
});
it('registered lane processes two explicitly registered mandates for the same actor without widening to legacy scopes',async()=>{
 const a='00000000-0000-4000-8000-000000000101',b='00000000-0000-4000-8000-000000000102',list=vi.fn(),registered=vi.fn().mockResolvedValue([{...scopes[0],mandateId:a},{...scopes[0],mandateId:b}]),process=vi.fn().mockResolvedValueOnce('idle').mockResolvedValueOnce('complete');
 expect(await runNativeTickWithPorts({enabled:true,scopeMode:'registered',runtimeId:'agent-multichannel-20261017',requireMandateScope:true,listRegisteredScopes:registered,listScopes:list,processScope:process} as never)).toEqual({enabled:true,processed:1,outcome:'complete'});
 expect(list).not.toHaveBeenCalled();expect(registered).toHaveBeenCalledWith(10,'agent-multichannel-20261017');expect(process).toHaveBeenNthCalledWith(1,scopes[0],a);expect(process).toHaveBeenNthCalledWith(2,scopes[0],b);
});
it('never falls back to global scopes for missing, mixed or malformed registered configuration',async()=>{
 for(const patch of [{runtimeId:undefined},{runtimeId:'Other Runtime'},{mandateId:'00000000-0000-4000-8000-000000000101'},{requireMandateScope:false}]){const list=vi.fn(),registered=vi.fn(),process=vi.fn();await expect(runNativeTickWithPorts({enabled:true,scopeMode:'registered',runtimeId:'agent-multichannel-20261017',requireMandateScope:true,listRegisteredScopes:registered,listScopes:list,processScope:process,...patch} as never)).rejects.toThrow();expect(list).not.toHaveBeenCalled();expect(registered).not.toHaveBeenCalled();expect(process).not.toHaveBeenCalled();}
});
it('recovers a committed review before due enumeration even when the original queue is exhausted',async()=>{const order:string[]=[],requestKey='00000000-0000-4000-8000-000000000154',list=vi.fn(async()=>{order.push('due');return [];});const result=await runNativeTickWithPorts({enabled:true,scopeMode:'registered',runtimeId:'agent-multichannel-20261017',requireMandateScope:true,listRegisteredReviewRecovery:async()=>[{...scopes[0],requestKey}],recoverReview:async(actor,key)=>{expect(actor).toEqual(scopes[0]);expect(key).toBe(requestKey);order.push('recover');},listRegisteredScopes:list,listScopes:vi.fn(),processScope:vi.fn()} as Parameters<typeof runNativeTickWithPorts>[0]);expect(order).toEqual(['recover','due']);expect(result).toMatchObject({processed:0});});
it('processes only registrations for a canonical production runtime without touching legacy enumeration',async()=>{const list=vi.fn(),registered=vi.fn().mockResolvedValue([{...scopes[0],mandateId:'00000000-0000-4000-8000-000000000101'}]),process=vi.fn().mockResolvedValue('complete');expect(await runNativeTickWithPorts({enabled:true,scopeMode:'registered',runtimeId:'acquire-production-au-1',requireMandateScope:true,listRegisteredScopes:registered,listScopes:list,processScope:process} as never)).toEqual({enabled:true,processed:1,outcome:'complete'});expect(registered).toHaveBeenCalledExactlyOnceWith(10,'acquire-production-au-1');expect(list).not.toHaveBeenCalled();expect(process).toHaveBeenCalledExactlyOnceWith(scopes[0],'00000000-0000-4000-8000-000000000101');});
