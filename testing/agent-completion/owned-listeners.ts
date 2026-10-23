import{createServer}from'node:https';import type{Server as HttpServer}from'node:http';
type Tls={key:Buffer;cert:Buffer};type Provider={close():Promise<void>};
/** A dedicated current-app gateway and the sibling simulator provider. Never
 * closes an unowned service, replaces an occupied port or changes a listener. */
export async function startCompletionListeners(input:{service:{server:HttpServer};tls:Tls;startProvider:(options:{host:'127.0.0.1';port:5990;tls:Tls})=>Promise<Provider>;beforeServiceRequest?:(request:{method:string;path:string})=>Promise<void>}){
 if(!Buffer.isBuffer(input.tls.key)||!input.tls.key.length||!Buffer.isBuffer(input.tls.cert)||!input.tls.cert.length)throw Error('Completion TLS unavailable');
 const provider=await input.startProvider({host:'127.0.0.1',port:5990,tls:input.tls});let gateway:ReturnType<typeof createServer>|undefined,closing:Promise<void>|undefined;
 const close=()=>closing??= (async()=>{const results=await Promise.allSettled([gateway?new Promise<void>((resolve,reject)=>gateway!.close(error=>error&&(error as NodeJS.ErrnoException).code!=='ERR_SERVER_NOT_RUNNING'?reject(error):resolve())):Promise.resolve(),provider.close()]);const errors=results.flatMap(result=>result.status==='rejected'?[result.reason]:[]);if(errors.length)throw new AggregateError(errors,'Completion listener shutdown incomplete');})();
 try{
  gateway=createServer(input.tls,(request,response)=>{const forward=()=>{input.service.server.emit('request',request,response);};if(!input.beforeServiceRequest)return forward();return (async()=>{try{await input.beforeServiceRequest!({method:request.method??'',path:new URL(request.url??'/', 'https://127.0.0.1:5991').pathname});if(!response.destroyed)forward();}catch{if(!response.headersSent&&!response.destroyed){response.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});response.end(JSON.stringify({error:'Completion network schedule unavailable'}));}}})();});
  await new Promise<void>((resolve,reject)=>{const failed=(error:Error)=>reject(error);gateway!.once('error',failed);gateway!.listen(5991,'127.0.0.1',()=>{gateway!.removeListener('error',failed);resolve();});});
  return{providerOrigin:'https://127.0.0.1:5990' as const,serviceOrigin:'https://127.0.0.1:5991' as const,close};
 }catch(error){try{await close();}catch{/* Original startup refusal remains authoritative. */}throw error;}
}
