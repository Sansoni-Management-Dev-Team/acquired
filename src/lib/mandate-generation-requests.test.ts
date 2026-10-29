import {expect,it,vi} from 'vitest';
import {emptyBrief} from '@/domain/acquisition';
import {createMandateGenerationRequests} from './mandate-generation-requests';
const scope={organizationId:'org',userId:'owner',requestId:'10000000-0000-4000-8000-000000000001',description:'Industrial maintenance in Queensland.'};
it('reuses one actor-scoped in-flight result across reload requests and rejects a changed brief for that identity',async()=>{
 const cache=createMandateGenerationRequests();let resolve!:(v:ReturnType<typeof emptyBrief>)=>void;const generate=vi.fn(()=>new Promise<ReturnType<typeof emptyBrief>>(done=>{resolve=done;}));
 const a=cache.run(scope,generate),b=cache.run(scope,generate);await Promise.resolve();expect(generate).toHaveBeenCalledOnce();await expect(cache.run({...scope,description:'A different acquisition brief.'},generate)).rejects.toMatchObject({status:409});resolve(emptyBrief());expect(await a).toEqual(await b);await cache.run(scope,generate);expect(generate).toHaveBeenCalledOnce();
});
it('does not share results across organisations or users',async()=>{
 const cache=createMandateGenerationRequests(),generate=vi.fn(async()=>emptyBrief());await cache.run(scope,generate);await cache.run({...scope,organizationId:'other'},generate);await cache.run({...scope,userId:'other'},generate);expect(generate).toHaveBeenCalledTimes(3);
});
it('releases failed attempts, expires completed cache entries and bounds capacity without evicting in-flight work',async()=>{
 let now=0;const cache=createMandateGenerationRequests({now:()=>now,ttlMs:100,maxEntries:1});const fail=vi.fn(async()=>{throw Error('unavailable');});await expect(cache.run(scope,fail)).rejects.toThrow();
 const generate=vi.fn(async()=>emptyBrief());await cache.run(scope,generate);now=101;await cache.run(scope,generate);expect(generate).toHaveBeenCalledTimes(2);
 const active=createMandateGenerationRequests({maxEntries:1});const pending=active.run(scope,()=>new Promise(()=>{}));void pending;await expect(active.run({...scope,requestId:'20000000-0000-4000-8000-000000000002'},generate)).rejects.toMatchObject({status:503});
});
