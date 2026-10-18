import {createServer,request as httpRequest} from 'node:http';
import {pathToFileURL} from 'node:url';
const SERVICE_URL='http://127.0.0.1:5461';
const CALLBACK=/^\/v1\/setup\/notify\?capability=[A-Za-z0-9._-]{1,128}$/;
// Hosted auth appends an opaque account_id to its browser return. Discard it:
// only the authenticated notification and owner polling may bind an account.
const RETURN=/^\/setup\/(returned|failed)(?:\?account_id=[A-Za-z0-9_-]{1,2048})?$/;
/** Public tunnel terminates here, never at the app or general service API.
 * Only opaque setup callbacks pass, without cookies, authentication headers or
 * forwarding headers. Capability authenticity remains the service's job.
 * Incoming bytes are collected from a bounded stream before any forwarding so
 * oversize/unfinished requests cannot cause a partial callback to be processed.
 */
export function createSetupCallbackGateway({serviceUrl=SERVICE_URL,maxBodyBytes=262144,timeoutMs=25000}={}){
 if(serviceUrl!==SERVICE_URL||!Number.isSafeInteger(maxBodyBytes)||maxBodyBytes<1||maxBodyBytes>262144||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>25000)throw new Error('Invalid local setup gateway configuration');
 const server=createServer({maxHeaderSize:8192},(req,res)=>{
  let finished=false,timer,upstream;
  const finish=(status,body,location)=>{
   if(finished)return;finished=true;clearTimeout(timer);
   if(upstream)upstream.destroy();
   res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Connection':'close',...(location?{Location:location}:{})});res.end(body);req.pause();
  };
  req.on('error',()=>finish(400,'{"error":"invalid_request"}'));
  res.on('close',()=>{finished=true;clearTimeout(timer);upstream?.destroy();req.pause();});
  if(req.method==='GET'&&req.url==='/health'){finish(200,'{"status":"ok"}');return;}
  const returned=req.method==='GET'?RETURN.exec(req.url??''):null;
  if(returned){finish(303,'{}','http://acquire-agent.orb.local/settings?setup='+returned[1]);return;}
  if(req.method!=='POST'||!CALLBACK.test(req.url??'')){finish(404,'{"error":"not_found"}');return;}
  const contentType=req.headers['content-type'];
  if(typeof contentType!=='string'||!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType)){finish(415,'{"error":"unsupported_content_type"}');return;}
  const declared=req.headers['content-length'];
  if(declared!==undefined&&(!/^[0-9]+$/.test(declared)||Number(declared)>maxBodyBytes)){finish(413,'{"error":"body_too_large"}');return;}
  timer=setTimeout(()=>finish(504,'{"error":"callback_timeout"}'),timeoutMs);
  let size=0;const chunks=[];
  req.on('data',chunk=>{if(finished)return;size+=chunk.length;if(size>maxBodyBytes){finish(413,'{"error":"body_too_large"}');return;}chunks.push(chunk);});
  req.on('end',()=>{
   if(finished)return;
   upstream=httpRequest(SERVICE_URL+req.url,{method:'POST',headers:{'Content-Type':contentType,'Content-Length':size,'Connection':'close'}},reply=>{
    let responseBytes=0;
    reply.on('data',chunk=>{responseBytes+=chunk.length;if(responseBytes>8192)finish(502,'{"error":"invalid_callback_response"}');});
    reply.on('error',()=>finish(503,'{"error":"callback_unavailable"}'));
    reply.on('end',()=>{
     const status=reply.statusCode??503;
     if(status>=200&&status<300)finish(200,'{"status":"accepted"}');
     else if(status>=400&&status<500)finish(status,'{"error":"callback_rejected"}');
     else finish(503,'{"error":"callback_unavailable"}');
    });
   });
   upstream.on('error',()=>finish(503,'{"error":"callback_unavailable"}'));
   upstream.end(Buffer.concat(chunks,size));
  });
 });
 server.headersTimeout=5000;server.requestTimeout=30000;server.keepAliveTimeout=1000;server.maxRequestsPerSocket=1;
 server.on('clientError',(_error,socket)=>socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'));
 return server;
}
export function callbackGatewayAddress(env=process.env){
 const host=env.AGENT_SETUP_GATEWAY_HOST??'127.0.0.1';
 if(!['127.0.0.1','0.0.0.0'].includes(host))throw new Error('Invalid local setup gateway bind address');
 return {host,port:5462};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const server=createSetupCallbackGateway(),address=callbackGatewayAddress();
  server.on('error',()=>{process.stderr.write('Local setup gateway failed.\n');process.exitCode=1;});
  server.listen(address.port,address.host);
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{server.close();server.closeAllConnections();});
 }catch{process.stderr.write('Local setup gateway configuration unavailable.\n');process.exitCode=1;}
}
