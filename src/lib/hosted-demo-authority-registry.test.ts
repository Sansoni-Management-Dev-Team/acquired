import {afterEach,expect,it,vi} from 'vitest';
import {createHostedDemoAuthorityRegistry} from './hosted-demo-authority-registry';
const binding={applicationId:'acquire',tenantId:'org',ownerId:'owner',connectionId:'connection',accountId:'account',generation:1,channel:'whatsapp',platform:'whatsapp',backend:'unipile'} as const;
const snapshot={binding,key:'original-operation',operation:'message',payloadDigest:'a'.repeat(64)} as const;
const challenge={record:{snapshot,recipient:{kind:'phone',value:'+15550000000'},state:'claimed'},claimToken:'claim',serviceRevision:'4'} as const;
const receipt={permitId:'permit',intentDigest:'b'.repeat(64),journalId:'journal',admissionId:'admission',snapshot,fencingToken:'1',serviceRevision:'4'};
const request={method:'session.open',requestId:'10000000-0000-4000-8000-000000000001',challenge} as const;
const signal=()=>new AbortController().signal;
const scope={applicationId:'acquire',tenantId:'org',ownerId:'owner'};
function fixture(options:Partial<Parameters<typeof createHostedDemoAuthorityRegistry>[0]>={}){
 const commit=vi.fn(async()=> 'committed' as const),abort=vi.fn(async()=>{}),permit={permitId:'permit',intentDigest:'b'.repeat(64),coverageScopes:[{binding,recipient:challenge.record.recipient,scopeDigest:'c'.repeat(64),requiredSince:'1970-01-01T00:00:00.000Z'}],commit,abort};
 const open=vi.fn(async()=>({kind:'held' as const,permit})),getPreparedCoverage=vi.fn(async()=>[{binding,scopeDigest:'c'.repeat(64)}]),admission=vi.fn(async()=>({open,getPreparedCoverage}));
 return {commit,abort,permit,open,getPreparedCoverage,admission,registry:createHostedDemoAuthorityRegistry({scope,admission,...options})};
}
afterEach(()=>vi.useRealTimers());
it('keeps actual authority held until exact service receipt commit and replays the same open without opening another transaction',async()=>{
 const f=fixture();try{const a=await f.registry.execute(request,signal()) as {sessionId:string},b=await f.registry.execute(structuredClone(request),signal());
  expect(a).toMatchObject({kind:'held',sessionId:expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),permit:{permitId:'permit',intentDigest:'b'.repeat(64)}});expect(b).toEqual(a);expect(f.open).toHaveBeenCalledOnce();expect(f.commit).not.toHaveBeenCalled();expect(f.abort).not.toHaveBeenCalled();
  expect(await f.registry.execute({method:'session.commit',sessionId:a.sessionId,receipt},signal())).toEqual({status:'committed'});expect(f.commit).toHaveBeenCalledExactlyOnceWith(receipt,expect.any(AbortSignal));
  expect(await f.registry.execute({method:'session.commit',sessionId:a.sessionId,receipt},signal())).toEqual({status:'committed'});expect(f.commit).toHaveBeenCalledOnce();
 }finally{await f.registry.close();}
});
it('authorizes every original binding against the captured actor before opening or reading prepared coverage',async()=>{
 const f=fixture();try{await expect(f.registry.execute({method:'prepared.get',snapshot:{...snapshot,binding:{...binding,ownerId:'foreign'}}},signal())).rejects.toThrow('Hosted authority unavailable');expect(f.admission).not.toHaveBeenCalled();
  expect(await f.registry.execute({method:'prepared.get',snapshot},signal())).toEqual({coverageScopes:[{binding,scopeDigest:'c'.repeat(64)}]});expect(f.getPreparedCoverage).toHaveBeenCalledExactlyOnceWith(snapshot);
 }finally{await f.registry.close();}
});
it('rejects changed challenge reuse and forged receipt before the actual commit method',async()=>{
 const f=fixture();try{const a=await f.registry.execute(request,signal()) as {sessionId:string};
  await expect(f.registry.execute({...request,challenge:{...challenge,claimToken:'other'}},signal())).rejects.toThrow('Hosted authority unavailable');expect(f.open).toHaveBeenCalledOnce();
  for(const patch of[{permitId:'other'},{serviceRevision:'5'},{snapshot:{...snapshot,payloadDigest:'d'.repeat(64)}}])await expect(f.registry.execute({method:'session.commit',sessionId:a.sessionId,receipt:{...receipt,...patch}},signal())).rejects.toThrow('Hosted authority unavailable');expect(f.commit).not.toHaveBeenCalled();
 }finally{await f.registry.close();}
});
it('expires live authority using real elapsed time and never reopens the same expired request',async()=>{
 vi.useFakeTimers();const f=fixture({ttlMs:1000});try{const a=await f.registry.execute(request,signal()) as {sessionId:string};await vi.advanceTimersByTimeAsync(1001);expect(f.abort).toHaveBeenCalledOnce();
  await expect(f.registry.execute({method:'session.commit',sessionId:a.sessionId,receipt},signal())).rejects.toThrow('Hosted authority unavailable');await expect(f.registry.execute(request,signal())).rejects.toThrow('Hosted authority unavailable');expect(f.open).toHaveBeenCalledOnce();expect(f.commit).not.toHaveBeenCalled();
 }finally{await f.registry.close();}
});
it('owns concurrent exact commit once and rejects a changed receipt after completion',async()=>{
 let finish!:(v:'committed')=>void;const f=fixture();f.commit.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));try{const a=await f.registry.execute(request,signal()) as {sessionId:string};
  const command={method:'session.commit' as const,sessionId:a.sessionId,receipt},one=f.registry.execute(command,signal()),two=f.registry.execute(command,signal());await Promise.resolve();finish('committed');expect(await Promise.all([one,two])).toEqual([{status:'committed'},{status:'committed'}]);expect(f.commit).toHaveBeenCalledOnce();
  await expect(f.registry.execute({...command,receipt:{...receipt,journalId:'changed'}},signal())).rejects.toThrow('Hosted authority unavailable');
 }finally{await f.registry.close();}
});
it('aborts and awaits late-opened authority after caller cancellation without exposing the underlying error',async()=>{
 const f=fixture();let finish!:(v:Awaited<ReturnType<typeof f.open>>)=>void;f.open.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));const controller=new AbortController();
 try{const pending=f.registry.execute(request,controller.signal);await Promise.resolve();controller.abort();finish({kind:'held',permit:f.permit});await expect(pending).rejects.toThrow('Hosted authority unavailable');expect(f.abort).toHaveBeenCalledOnce();expect(f.commit).not.toHaveBeenCalled();
 }finally{await f.registry.close();}
});
it('bounds retained request identities, preserves original holds and closes only owned transactions once',async()=>{
 const f=fixture({capacity:1});const a=await f.registry.execute(request,signal()) as {sessionId:string};
 await expect(f.registry.execute({...request,requestId:'10000000-0000-4000-8000-000000000002'},signal())).rejects.toThrow('Hosted authority unavailable');expect(f.open).toHaveBeenCalledOnce();
 expect(await f.registry.execute({method:'session.abort',sessionId:a.sessionId},signal())).toEqual({status:'aborted'});await f.registry.close();await f.registry.close();expect(f.abort).toHaveBeenCalledOnce();await expect(f.registry.execute({method:'prepared.get',snapshot},signal())).rejects.toThrow('Hosted authority unavailable');
});
it('retains failed commit uncertainty without rerunning the permit or exposing private failures',async()=>{
 const f=fixture();f.commit.mockRejectedValue(Error('PRIVATE database credential failure'));try{const a=await f.registry.execute(request,signal()) as {sessionId:string},command={method:'session.commit' as const,sessionId:a.sessionId,receipt};
  await expect(f.registry.execute(command,signal())).rejects.toThrow('Hosted authority unavailable');await expect(f.registry.execute(command,signal())).rejects.toThrow('Hosted authority unavailable');expect(f.commit).toHaveBeenCalledOnce();expect(f.abort).toHaveBeenCalledOnce();
 }finally{await f.registry.close();}
});
it('reports safe correlated open stages without challenge or permit secrets',async()=>{
 const log=vi.spyOn(console,'info').mockImplementation(()=>{});const f=fixture();
 try{await f.registry.execute(request,signal());
 const entries=log.mock.calls.filter(x=>x[0]==='hosted-authority').map(x=>JSON.parse(x[1] as string));
 expect(entries).toEqual(expect.arrayContaining([
  expect.objectContaining({stage:'binding.resolve',outcome:'complete',requestId:request.requestId}),
  expect.objectContaining({stage:'admission.open',outcome:'held',requestId:request.requestId}),
  expect.objectContaining({stage:'response',outcome:'held',requestId:request.requestId}),
 ]));expect(JSON.stringify(entries)).not.toMatch(/claimToken|original-operation|155500|sessionId|scopeDigest/);
 }finally{await f.registry.close();log.mockRestore();}
});
it('reports cancellation and stage failure safely when binding resolution fails',async()=>{
 const log=vi.spyOn(console,'info').mockImplementation(()=>{});const f=fixture({admission:async()=>{throw Error('PRIVATE token SQL');}});
 try{await expect(f.registry.execute(request,signal())).rejects.toThrow('Hosted authority unavailable');
 const entries=log.mock.calls.filter(x=>x[0]==='hosted-authority').map(x=>JSON.parse(x[1] as string));
 expect(entries).toEqual(expect.arrayContaining([expect.objectContaining({stage:'binding.resolve',outcome:'error'}),expect.objectContaining({stage:'cancel',outcome:'closed'})]));expect(JSON.stringify(entries)).not.toContain('PRIVATE');
 }finally{await f.registry.close();log.mockRestore();}
});
it('does not change held authority when diagnostic output fails',async()=>{
 const log=vi.spyOn(console,'info').mockImplementation(()=>{throw Error('sink unavailable');});const f=fixture();
 try{await expect(f.registry.execute(request,signal())).resolves.toMatchObject({kind:'held'});expect(f.open).toHaveBeenCalledOnce();}
 finally{await f.registry.close();log.mockRestore();}
});
