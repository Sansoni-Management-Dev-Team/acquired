import {createServer,request,type Server} from 'node:http';
import {once} from 'node:events';
import {expect,it,vi} from 'vitest';
import {createCommunicationsListener} from './listener';
import {createReplyWebhookServer} from './reply-webhook-server';
import {createSetupCallbackServer} from './setup-callback-server';
async function close(server:Server){server.closeAllConnections();if(server.listening)await new Promise<void>(resolve=>server.close(()=>resolve()));}
it.each(['webhook','setup'] as const)('holds aroundRequest beyond the %s retry response until original durable work settles',async type=>{
 let finish!:(value:unknown)=>void,entered!:()=>void,active=0;const ready=new Promise<void>(resolve=>entered=resolve),pending=new Promise(resolve=>finish=resolve),capture=vi.fn(async()=>{entered();return pending;});
 const child=type==='webhook'?createReplyWebhookServer({ingress:{authenticate:()=>true,capture:capture as never},bodyTimeoutMs:100,captureTimeoutMs:20}):createSetupCallbackServer({runtime:{completeSetupNotification:capture as never},bodyTimeoutMs:100,captureTimeoutMs:20});
 const inert=createServer((_req,res)=>res.end()),parts={api:inert,setup:type==='setup'?child:inert,webhook:type==='webhook'?child:inert};
 const server=createCommunicationsListener(parts,{aroundRequest:async<T>(work:()=>Promise<T>)=>{active++;try{return await work();}finally{active--;}}});server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address||typeof address==='string')throw Error();
 try{const result=await fetch(`http://127.0.0.1:${address.port}`+(type==='webhook'?'/v1/webhook':'/v1/setup/notify?capability=fixture'),{method:'POST',headers:{'content-type':'application/json'},body:'{}'});await ready;expect(result.status).toBe(503);await result.text();expect(active).toBe(1);finish(type==='webhook'?{status:'accepted'}:{status:'queued'});await vi.waitFor(()=>expect(active).toBe(0));expect(capture).toHaveBeenCalledOnce();}
 finally{finish({status:'retry'});await close(server);await close(child);await close(inert);}
});
it('a closed caller socket does not release outstanding native callback work',async()=>{
 let finish!:(value:unknown)=>void,entered!:()=>void,active=0;const ready=new Promise<void>(resolve=>entered=resolve),pending=new Promise(resolve=>finish=resolve);
 const child=createReplyWebhookServer({ingress:{authenticate:()=>true,capture:async()=>{entered();return pending as never;}},bodyTimeoutMs:100,captureTimeoutMs:1000}),inert=createServer((_req,res)=>res.end()),server=createCommunicationsListener({api:inert,setup:inert,webhook:child},{aroundRequest:async<T>(work:()=>Promise<T>)=>{active++;try{return await work();}finally{active--;}}});server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address||typeof address==='string')throw Error();
 const req=request(`http://127.0.0.1:${address.port}/v1/webhook`,{method:'POST',headers:{'content-type':'application/json'}},res=>res.resume());req.on('error',()=>{});req.end('{}');
 try{await ready;req.destroy();await new Promise(resolve=>setImmediate(resolve));expect(active).toBe(1);finish({status:'accepted'});await vi.waitFor(()=>expect(active).toBe(0));}
 finally{finish({status:'retry'});req.destroy();await close(server);await close(child);await close(inert);}
});
