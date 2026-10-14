import {createServer,type Server} from 'node:http';
import {once} from 'node:events';
import {expect,it} from 'vitest';
import {createCommunicationsListener} from './listener';
it('routes the API, setup callback and webhook to their dedicated bounded handlers on one listener',async()=>{
 const child=(label:string)=>createServer((_request,response)=>{response.writeHead(200,{'Content-Type':'text/plain'});response.end(label);});
 const parts={api:child('api'),setup:child('setup'),webhook:child('webhook')},server=createCommunicationsListener(parts);server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address||typeof address==='string')throw Error();const url=`http://127.0.0.1:${address.port}`;
 try{expect(await (await fetch(url+'/health')).text()).toBe('api');expect(await (await fetch(url+'/v1/setup/notify?capability=synthetic')).text()).toBe('setup');expect(await (await fetch(url+'/v1/webhook',{method:'POST'})).text()).toBe('webhook');expect(await (await fetch(url+'/v1/connections/list',{method:'POST'})).text()).toBe('api');expect((await fetch(url+'/unknown')).status).toBe(404);expect((await fetch(url+'/v1/webhook?owner=forged',{method:'POST'})).status).toBe(404);}finally{await close(server);for(const part of Object.values(parts))part.closeAllConnections();}
});
async function close(server:Server){server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
