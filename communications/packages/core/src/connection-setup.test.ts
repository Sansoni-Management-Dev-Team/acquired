import { performance as monotonicClock } from 'node:perf_hooks';
import { describe,expect,it,vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createConnectionSetupCoordinator,type ConnectionSetupOptions } from './connection-setup';
const scope={applicationId:'app',tenantId:'tenant',ownerId:'owner'},binding={...scope,connectionId:'connection',accountId:'stable-account',generation:1,channel:'whatsapp' as const,platform:'whatsapp' as const,backend:'unipile' as const};
const nonce='A'.repeat(43);
function fixture(change:Partial<ConnectionSetupOptions>={}){
 const issue=vi.fn(async()=>({nonce,expiresAt:new Date(Date.now()+60_000).toISOString(),expectedConnectionId:'new-connection',expectedGeneration:1}));
 const complete=vi.fn(async()=>({status:'completed' as const,binding}));
 const createLink=vi.fn<ConnectionSetupOptions['hostedAuth']['createLink']>(async()=>({kind:'success' as const,status:200,data:{object:'HostedAuthURL',url:'https://account.example.test/setup'}}));
 const resolveReconnect=vi.fn(async()=>({binding,providerAccountId:'opaque/provider/account'}));
 const options:ConnectionSetupOptions={scope,channel:'whatsapp',platform:'whatsapp',backend:'unipile',redirectOrigin:'https://app.example.test',successPath:'/settings/connections?setup=success',failurePath:'/settings/connections?setup=failed',notifyUrl:'https://service.example.test/setup/notification',states:{issue,complete},hostedAuth:{createLink},resolveReconnect,...change};
 return {options,issue,complete,createLink,resolveReconnect,coordinator:()=>createConnectionSetupCoordinator(options)};
}
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
describe('provider-neutral hosted setup lifecycle',()=>{
 it.each(['state','provider','notification','before_provider'])('handles blocked/rejected %s callback in native Node without late authority or unhandled rejection',mode=>{
  const script=String.raw`
   const fs=require('node:fs'),ts=require('typescript'),{performance}=require('node:perf_hooks');
   const realNow=performance.now.bind(performance);let fixtureNow=0;Object.defineProperty(performance,'now',{value:()=>fixtureNow,configurable:true});
   require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
   const {createConnectionSetupCoordinator}=require(process.argv[2]),mode=process.argv[1];let posts=0;
   const delayedRejection=()=>{const end=realNow()+20;while(realNow()<end){}fixtureNow+=20;return Promise.reject(Error('Synthetic blocked callback failure'));};
   const coordinator=createConnectionSetupCoordinator({scope:{applicationId:'app',tenantId:'tenant',ownerId:'owner'},channel:'whatsapp',platform:'whatsapp',backend:'unipile',redirectOrigin:'https://app.example.test',successPath:'/success',failurePath:'/failure',notifyUrl:'https://service.example.test/notification',timeoutMs:5,
    states:{issue(){if(mode==='state')return delayedRejection();if(mode==='before_provider')fixtureNow=20;return Promise.resolve({nonce:'A'.repeat(43),expiresAt:new Date(Date.now()+60000).toISOString(),expectedConnectionId:'connection',expectedGeneration:1});},complete(){return delayedRejection();}},
    hostedAuth:{createLink(){posts++;return delayedRejection();}},resolveReconnect:async()=>{throw Error('Unexpected reconnect');}});
   const pending=mode==='notification'?coordinator.complete({nonce:'A'.repeat(43),notification:{}}):coordinator.begin();
   pending.then(result=>setTimeout(()=>process.stdout.write(JSON.stringify({status:result.status,posts})),20));
  `;
  const result=spawnSync(process.execPath,['--unhandled-rejections=strict','-e',script,mode,fileURLToPath(new URL('./connection-setup.ts',import.meta.url))],{encoding:'utf8',timeout:3000});
  expect(result.status).toBe(0);expect(JSON.parse(result.stdout)).toEqual({status:['state','before_provider'].includes(mode)?'unavailable':'unknown',posts:mode==='provider'?1:0});
 });
 it.each([['email','gmail'],['email','outlook'],['email','imap'],['whatsapp','whatsapp'],['linkedin','linkedin']] as const)('issues durable %s/%s setup before one provider call',async(channel,platform)=>{
  const f=fixture({channel,platform});expect(await f.coordinator().begin()).toMatchObject({status:'redirect',action:{type:'redirect',url:'https://account.example.test/setup'}});expect(f.issue).toHaveBeenCalledOnce();expect(f.createLink).toHaveBeenCalledOnce();expect(f.issue.mock.invocationCallOrder[0]).toBeLessThan(f.createLink.mock.invocationCallOrder[0]);
  const input=f.createLink.mock.calls[0]?.[0] as unknown as Record<string,unknown>;expect(input).toMatchObject({type:'create',channel,platform,successRedirectUrl:'https://app.example.test/settings/connections?setup=success',failureRedirectUrl:'https://app.example.test/settings/connections?setup=failed',notifyUrl:'https://service.example.test/setup/notification'});expect(input.state===nonce).toBe(true);expect(input).not.toHaveProperty('providerAccountId');
 });
 it('waits for durable state commit before provider POST',async()=>{
  const committed=deferred<Awaited<ReturnType<ConnectionSetupOptions['states']['issue']>>>(),f=fixture({states:{issue:()=>committed.promise,complete:async()=>({status:'rejected',code:'invalid'})}}),pending=f.coordinator().begin();await Promise.resolve();expect(f.createLink).not.toHaveBeenCalled();committed.resolve({nonce,expiresAt:new Date(Date.now()+60_000).toISOString(),expectedConnectionId:'new',expectedGeneration:1});expect((await pending).status).toBe('redirect');
 });
 it('does not call the provider if durable state fails',async()=>{const f=fixture({states:{issue:async()=>{throw Error('private database');},complete:async()=>({status:'rejected',code:'invalid'})}});expect(await f.coordinator().begin()).toEqual({status:'unavailable'});expect(f.createLink).not.toHaveBeenCalled();});
 it.each([{nonce:'bad'}, {expiresAt:'2020-01-01T00:00:00.000Z'}, {expectedGeneration:2}, {expectedConnectionId:''}])('rejects invalid issued state before provider I/O %#',async change=>{const f=fixture();f.issue.mockImplementation(async()=>({nonce,expiresAt:new Date(Date.now()+60_000).toISOString(),expectedConnectionId:'new',expectedGeneration:1,...change}));expect(await f.coordinator().begin()).toEqual({status:'unavailable'});expect(f.createLink).not.toHaveBeenCalled();});
 it('reconnects only the exact authorized original provider account',async()=>{
  const f=fixture();f.issue.mockImplementation(async()=>({nonce,expiresAt:new Date(Date.now()+60_000).toISOString(),expectedConnectionId:binding.connectionId,expectedGeneration:2}));expect((await f.coordinator().begin({reconnectBinding:binding})).status).toBe('redirect');expect(f.resolveReconnect).toHaveBeenCalledOnce();expect(f.issue).toHaveBeenCalledWith({reconnectBinding:binding});const input=f.createLink.mock.calls[0]?.[0] as unknown as Record<string,unknown>;expect(input).toMatchObject({type:'reconnect',providerAccountId:'opaque/provider/account'});
 });
 it.each([{ownerId:'other'},{accountId:'other'},{generation:2},{connectionId:'other'},{backend:'browser'}])('refuses changed reconnect provenance %#',async mismatch=>{const f=fixture({resolveReconnect:async()=>({binding:{...binding,...mismatch} as typeof binding,providerAccountId:'secret-account'})});expect(await f.coordinator().begin({reconnectBinding:binding})).toEqual({status:'unavailable'});expect(f.issue).not.toHaveBeenCalled();expect(f.createLink).not.toHaveBeenCalled();});
 it('rejects foreign owner reconnect before resolving or issuing',async()=>{const f=fixture();expect(await f.coordinator().begin({reconnectBinding:{...binding,ownerId:'other'}})).toEqual({status:'rejected',code:'invalid'});expect(f.resolveReconnect).not.toHaveBeenCalled();expect(f.issue).not.toHaveBeenCalled();});
 it('refuses a reconnect state that addresses a different generation',async()=>{const f=fixture();expect(await f.coordinator().begin({reconnectBinding:binding})).toEqual({status:'unavailable'});expect(f.createLink).not.toHaveBeenCalled();});
 it.each([{providerAccountId:'caller-account'},{successRedirectUrl:'https://evil.test'},{state:'caller-nonce'}])('rejects client-controlled setup authority %#',async input=>{const f=fixture();expect(await f.coordinator().begin(input as never)).toEqual({status:'rejected',code:'invalid'});expect(f.issue).not.toHaveBeenCalled();});
 it.each(['unknown','unavailable','not_submitted'])('does not retry an ambiguous/provider-failed link POST (%s)',async kind=>{const f=fixture({hostedAuth:{createLink:async()=>({kind:kind as 'unknown',reason:'private provider failure'})}});expect(await f.coordinator().begin()).toEqual({status:'unknown'});expect(f.issue).toHaveBeenCalledOnce();});
 it('sanitizes a lost POST response and never reissues state or retries the provider',async()=>{const link=vi.fn(async()=>{throw Error('secret-account private response');}),f=fixture({hostedAuth:{createLink:link}});expect(await f.coordinator().begin()).toEqual({status:'unknown'});expect(link).toHaveBeenCalledOnce();expect(f.issue).toHaveBeenCalledOnce();});
 it('returns only a redirect action, without durable IDs, nonce or claimed readiness',async()=>{const f=fixture(),result=await f.coordinator().begin();expect(Object.keys(result).sort()).toEqual(['action','status']);expect(result).not.toHaveProperty('binding');expect(JSON.stringify(result).includes(nonce)).toBe(false);expect(result).not.toHaveProperty('ready');});
 it('waits for notification commit before reporting the recorded binding',async()=>{const commit=deferred<Awaited<ReturnType<ConnectionSetupOptions['states']['complete']>>>(),f=fixture({states:{issue:async()=>{throw Error('unused');},complete:()=>commit.promise}});let settled=false;const pending=f.coordinator().complete({nonce,notification:{provider:true}}).then(result=>{settled=true;return result;});await Promise.resolve();expect(settled).toBe(false);commit.resolve({status:'completed',binding});expect(await pending).toEqual({status:'recorded',binding});});
 it('reports exact replay proof without claiming current readiness',async()=>{const f=fixture({states:{issue:async()=>{throw Error('unused');},complete:async()=>({status:'consumed',binding})}});expect(await f.coordinator().complete({nonce,notification:{}})).toEqual({status:'duplicate',binding});});
 it('marks consumed state without exact binding proof for reconciliation',async()=>{const f=fixture({states:{issue:async()=>{throw Error('unused');},complete:async()=>({status:'consumed',needsReconciliation:true})}});expect(await f.coordinator().complete({nonce,notification:{}})).toEqual({status:'review',code:'reconciliation_required'});});
 it.each(['unauthenticated','invalid','expired','forbidden','reconnect_changed'] as const)('preserves durable notification rejection (%s)',async code=>{const f=fixture({states:{issue:async()=>{throw Error('unused');},complete:async()=>({status:'rejected',code})}});expect(await f.coordinator().complete({nonce,notification:{}})).toEqual({status:'rejected',code});expect(f.createLink).not.toHaveBeenCalled();});
 it('never treats browser redirect parameters as completed setup',async()=>{const f=fixture();expect(await f.coordinator().complete({nonce,success:true,accountId:'caller-account'} as never)).toEqual({status:'rejected',code:'invalid'});expect(f.complete).not.toHaveBeenCalled();});
 it('refuses malformed or foreign committed bindings',async()=>{const f=fixture({states:{issue:async()=>{throw Error('unused');},complete:async()=>({status:'completed',binding:{...binding,ownerId:'other'}})}});expect(await f.coordinator().complete({nonce,notification:{}})).toEqual({status:'unknown'});});
 it.each(['status','code'])('does not coerce notification result primitives (%s)',async field=>{
  const coerce=vi.fn(()=>field==='status'?'completed':'expired'),value={toString:coerce};
  const result=field==='status'?{status:value,binding}:{status:'rejected',code:value};
  const f=fixture({states:{issue:async()=>{throw Error('unused');},complete:async()=>result as never}});expect(await f.coordinator().complete({nonce,notification:{}})).toEqual({status:'unknown'});expect(coerce).not.toHaveBeenCalled();
 });
 it('captures dependencies and fixed configuration before callbacks mutate them',async()=>{const f=fixture(),coordinator=f.coordinator();f.options.redirectOrigin='https://evil.test';f.options.hostedAuth.createLink=async()=>{throw Error('replacement');};expect((await coordinator.begin()).status).toBe('redirect');expect(f.createLink).toHaveBeenCalledOnce();});
 it.each([{timeoutMs:0},{timeoutMs:30000},{timeoutMs:1.5},{successPath:'//evil.test'},{successPath:'/success\n?normalized=1'},{failurePath:'https://evil.test'},{redirectOrigin:'https://app.example.test/path'},{notifyUrl:'http://evil.test'},{redirectOrigin:'http://127.0.0.1:3000'},{backend:'unknown'},{channel:'email',platform:'whatsapp'}] as Partial<ConnectionSetupOptions>[])('rejects unsafe fixed setup configuration %#',change=>{expect(()=>fixture(change).coordinator()).toThrow('Invalid connection setup configuration');});
 it('bounds stalled provider link creation and ignores late success',async()=>{const link=deferred<Awaited<ReturnType<ConnectionSetupOptions['hostedAuth']['createLink']>>>();let signal:AbortSignal|undefined;const f=fixture({timeoutMs:10,hostedAuth:{createLink:(_input,options)=>{signal=options?.signal;return link.promise;}}});expect(await f.coordinator().begin()).toEqual({status:'unknown'});expect(signal?.aborted).toBe(true);link.resolve({kind:'success',status:200,data:{url:'https://account.example.test/late'}});});
 it('prevents provider invocation after a synchronous state overrun',async()=>{
  vi.useFakeTimers();let now=0;const clock=vi.spyOn(monotonicClock,'now').mockImplementation(()=>now);
  try {const f=fixture({timeoutMs:5,states:{issue:async()=>{now=15;return {nonce,expiresAt:new Date(Date.now()+60_000).toISOString(),expectedConnectionId:'new',expectedGeneration:1};},complete:async()=>({status:'rejected',code:'invalid'})}});expect(await f.coordinator().begin()).toEqual({status:'unavailable'});expect(f.createLink).not.toHaveBeenCalled();}
  finally {clock.mockRestore();vi.useRealTimers();}
 });
 it('prevents redirect success after a synchronous provider overrun',async()=>{
  vi.useFakeTimers();let now=0;const clock=vi.spyOn(monotonicClock,'now').mockImplementation(()=>now),provider=vi.fn(async()=>{now=15;return {kind:'success' as const,status:200,data:{url:'https://account.example.test/late'}};});
  try {const f=fixture({timeoutMs:5,hostedAuth:{createLink:provider}});expect(await f.coordinator().begin()).toEqual({status:'unknown'});expect(provider).toHaveBeenCalledOnce();}
  finally {clock.mockRestore();vi.useRealTimers();}
 });
 it('returns unknown for notification timeout while permitting later durable commit/replay',async()=>{const commit=deferred<Awaited<ReturnType<ConnectionSetupOptions['states']['complete']>>>(),f=fixture({timeoutMs:10,states:{issue:async()=>{throw Error('unused');},complete:()=>commit.promise}});expect(await f.coordinator().complete({nonce,notification:{}})).toEqual({status:'unknown'});commit.resolve({status:'completed',binding});});
});
