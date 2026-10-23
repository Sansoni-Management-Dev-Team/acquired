import {createServer,type Server,type ServerResponse} from 'node:http';
export type CommunicationsAroundRequest=<T>(work:()=>Promise<T>)=>Promise<T>;
async function responseFinished(response:ServerResponse){if(response.writableFinished||response.destroyed)return;await new Promise<void>(resolve=>{const done=()=>{response.off('finish',done);response.off('close',done);resolve();};response.once('finish',done);response.once('close',done);});}
/** Share one listener while preserving independent authentication and body/capture bounds. */
export function createCommunicationsListener(parts:{api:Server;setup:Server;webhook:Server},options?:{aroundRequest?:CommunicationsAroundRequest}):Server{
 const aroundRequest=options?.aroundRequest;
 if(aroundRequest!==undefined&&typeof aroundRequest!=='function')throw Error('Invalid native request admission');
 const server=createServer((request,response)=>{
  let target:Server|undefined;
  if(request.url?.startsWith('/v1/setup/notify?'))target=parts.setup;
  else if(request.url==='/v1/webhook')target=parts.webhook;
  else if(request.url==='/health'||/^\/v1\/(?:connections\/(?:list|setup|status|disconnect|default)|ready|submit|lookup(?:\/details)?|relationships\/inspect)$/.test(request.url??''))target=parts.api;
  if(target){
   if(!aroundRequest){target.emit('request',request,response);return;}
   const selected=target;
   void Promise.resolve().then(()=>aroundRequest(async()=>{const handlers=selected.listeners('request');if(handlers.length!==1)throw Error('Native request handler unavailable');await Reflect.apply(handlers[0],selected,[request,response]);await responseFinished(response);})).catch(()=>{request.resume();if(!response.destroyed&&!response.writableEnded){response.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});response.end(JSON.stringify({error:{code:'service_busy'}}));}});
   return;
  }
  request.resume();response.writeHead(404,{'Content-Type':'application/json','Cache-Control':'no-store'});response.end(JSON.stringify({error:{code:'not_found'}}));
 });
 server.headersTimeout=5000;server.requestTimeout=25000;return server;
}
