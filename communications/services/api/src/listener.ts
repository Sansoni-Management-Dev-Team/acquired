import {createServer,type Server} from 'node:http';
/** Share one listener while preserving independent authentication and body/capture bounds. */
export function createCommunicationsListener(parts:{api:Server;setup:Server;webhook:Server}):Server{
 const server=createServer((request,response)=>{
  let target:Server|undefined;
  if(request.url?.startsWith('/v1/setup/notify?'))target=parts.setup;
  else if(request.url==='/v1/webhook')target=parts.webhook;
  else if(request.url==='/health'||/^\/v1\/(?:connections\/(?:list|setup|status|disconnect|default)|ready|submit|lookup(?:\/details)?|relationships\/inspect)$/.test(request.url??''))target=parts.api;
  if(target){target.emit('request',request,response);return;}
  request.resume();response.writeHead(404,{'Content-Type':'application/json','Cache-Control':'no-store'});response.end(JSON.stringify({error:{code:'not_found'}}));
 });
 server.headersTimeout=5000;server.requestTimeout=25000;return server;
}
