import {createServer as tcpServer,connect} from 'node:net';
import {createServer as httpServer,request} from 'node:http';
import {createServer as httpsServer} from 'node:https';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

export function simulatorBridgeAddress(env){
 if(env.AGENT_MODE_COMMUNICATIONS_MODE!=='simulator'||env.NODE_ENV==='production')throw Error('Simulator profile required');
 const profile=env.AGENT_MODE_COMMUNICATIONS_PROFILE??'simulator';
 if(!['simulator','simulator25','simulator50','multichannel','demos'].includes(profile))throw Error('Unknown simulator profile');
 return profile==='demos'?{providerPort:5890,callbackPort:5891,servicePort:5463,hostProviderPort:5893}:profile==='multichannel'?{providerPort:5790,callbackPort:5791,servicePort:5461}:profile==='simulator50'?{providerPort:5690,callbackPort:5691,servicePort:5461}:profile==='simulator25'?{providerPort:5590,callbackPort:5591,servicePort:5461}:{providerPort:5490,callbackPort:5491,servicePort:5461};
}
/** Fixed loopback service, bounded complete bodies, no redirects/retries. The
 * service retains authentication, original receipts and webhook validation. */
export function createSimulatorGateway({tls,servicePort=5461,maxBodyBytes=1048576,timeoutMs=28000}={}){
 if(!Number.isInteger(servicePort)||servicePort<1||servicePort>65535||!Number.isInteger(maxBodyBytes)||maxBodyBytes<1||maxBodyBytes>1048576||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>28000)throw Error('Invalid gateway bounds');
 const server=(tls?httpsServer:httpServer)(tls??{},(req,res)=>{
  let upstream,timer,done=false;
  const finish=(status,body,headers={})=>{if(done)return;done=true;clearTimeout(timer);upstream?.destroy();req.resume();res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','referrer-policy':'no-referrer',...headers});res.end(body);};
  const returned=req.method==='GET'?/^\/setup\/(returned|failed)$/.exec(req.url??''):null;
  if(returned)return finish(303,'{}',{location:'http://acquire-agent.orb.local/settings?setup='+returned[1]});
  const known=req.method==='GET'&&req.url==='/health'||req.method==='POST'&&(/^\/v1\/(?:webhook|connections\/(?:list|setup|status|disconnect|default)|ready|submit|lookup(?:\/details)?|relationships\/inspect)$/.test(req.url??'')||/^\/v1\/setup\/notify\?capability=[A-Za-z0-9._-]{1,128}$/.test(req.url??''));
  if(!known)return finish(404,'{"error":"not_found"}');
  const declared=req.headers['content-length'];if(declared!==undefined&&(!/^\d+$/.test(declared)||Number(declared)>maxBodyBytes))return finish(413,'{"error":"body_too_large"}');
  let size=0;const chunks=[];timer=setTimeout(()=>finish(504,'{"error":"gateway_timeout"}'),timeoutMs);
  req.on('error',()=>finish(400,'{"error":"invalid_request"}'));
  res.on('close',()=>{done=true;clearTimeout(timer);upstream?.destroy();});
  req.on('data',b=>{if(done)return;size+=b.length;if(size>maxBodyBytes)return finish(413,'{"error":"body_too_large"}');chunks.push(b);});
  req.on('end',()=>{
   if(done)return;
   const headers={'content-length':size};for(const key of ['content-type','authorization','unipile-auth','x-communications-contract-version'])if(typeof req.headers[key]==='string')headers[key]=req.headers[key];
   upstream=request({host:'127.0.0.1',port:servicePort,path:req.url,method:req.method,headers},reply=>{
    const output=[];let length=0;
    reply.on('data',b=>{length+=b.length;if(length>1048576)return finish(502,'{"error":"invalid_response"}');output.push(b);});
    reply.on('error',()=>finish(502,'{"error":"upstream_unavailable"}'));
    reply.on('end',()=>finish(reply.statusCode??502,Buffer.concat(output),typeof reply.headers['x-communications-contract-version']==='string'?{'x-communications-contract-version':reply.headers['x-communications-contract-version']}:{}));
   });
   upstream.on('error',()=>finish(503,'{"error":"upstream_unavailable"}'));upstream.end(Buffer.concat(chunks,size));
  });
 });
 server.headersTimeout=5000;server.requestTimeout=30000;server.keepAliveTimeout=1000;
 return server;
}
export async function startSimulatorTransports(env=process.env){
 const {providerPort,callbackPort,servicePort,hostProviderPort=providerPort}=simulatorBridgeAddress(env),directory='/workspace/.local-data/agent-mode-orbstack/simulator-tls';
 const tls={key:await readFile(directory+'/localhost.key'),cert:await readFile(directory+'/localhost.crt')};
 const sockets=new Set();
 const relay=tcpServer(socket=>{
  const upstream=connect({host:'host.docker.internal',port:hostProviderPort});sockets.add(socket);sockets.add(upstream);
  for(const [a,b] of [[socket,upstream],[upstream,socket]]){a.setTimeout(30000,()=>a.destroy());a.on('error',()=>b.destroy());a.on('close',()=>{sockets.delete(a);b.destroy();});}socket.pipe(upstream).pipe(socket);
 });
 const gateway=createSimulatorGateway({tls,servicePort});
 const listen=(server,port,host)=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
 try{await listen(relay,providerPort,'127.0.0.1');await listen(gateway,callbackPort,'0.0.0.0');}
 catch(error){for(const socket of sockets)socket.destroy();relay.close();gateway.close();throw error;}
 return {async close(){for(const socket of sockets)socket.destroy();gateway.closeAllConnections();await Promise.all([new Promise(r=>relay.close(r)),new Promise(r=>gateway.close(r))]);}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 startSimulatorTransports().then(server=>{console.log('Local simulator transports ready for the selected fixed profile');for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void server.close().then(()=>process.exit());});}).catch(()=>{console.error('Simulator transports unavailable');process.exitCode=1;});
}
