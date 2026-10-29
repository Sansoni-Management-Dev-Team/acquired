// Callback relay between Acquire and this worker. Tokens are
// translated internally; no browser session cookies or arbitrary URLs are used.
import {createServer} from 'node:http';
import {createHash,timingSafeEqual} from 'node:crypto';
const uuid='[a-f\\d]{8}-(?:[a-f\\d]{4}-){3}[a-f\\d]{12}';
const jobPath=new RegExp(`^/jobs/${uuid}$`,'i');
const refreshPath=new RegExp(`^/firmable/${uuid}$`,'i');
const callbackPath=new RegExp(`^/api/(?:research/internal/${uuid}(?:/timings)?|firmable/internal/${uuid})$`,'i');
const firmableMethods=new Map(Object.entries({'/firmable/company/search':'POST','/firmable/company':'GET','/firmable/people/phones':'POST','/firmable/people':'GET','/firmable/people/search':'POST','/firmable/status':'GET','/firmable/reconnect':'POST'}));
function authorized(value,secret){const hash=text=>createHash('sha256').update(text).digest();return timingSafeEqual(hash(value||''),hash(`Bearer ${secret}`))}
export function createAcquireBridge({workerSecret,appSecret,appFirmableSecret=appSecret,appOrigin='http://host.docker.internal:3027',appSite='https://acquire-isolated.orb.local',production=false,fetcher=fetch}) {
  if(!workerSecret||!appSecret)throw Error('Both bridge service secrets are required');
  const port=appSite==='https://acquire-isolated.orb.local'?3027:appSite==='https://acquire-research.orb.local'?3032:null;
  if(production){
    if(appOrigin!=='https://acquire.mlai.au'||appSite!==appOrigin)throw Error('Production relay requires the exact Acquire HTTPS origin');
  }else if(!port||![`http://host.docker.internal:${port}`,`http://127.0.0.1:${port}`].includes(appOrigin))throw Error('Only matching configured local isolated Acquire origins are allowed');
  return createServer(async(req,res)=>{
    const reply=(status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value))};
    try{
      const url=new URL(req.url,'http://127.0.0.1:3100');
      if(url.pathname==='/health/ready'&&req.method==='GET'){
        const response=await fetcher('http://127.0.0.1:8787/health/ready',{redirect:'manual',signal:AbortSignal.timeout(3000)});
        await response.body?.cancel();return reply(response.ok?200:503,{ready:response.ok,mode:production?'acquire-production':'acquire-isolated',app:appSite});
      }
      const background=url.pathname==='/api/research/internal/background';
      const callback=callbackPath.test(url.pathname)||background;
      const firmable=firmableMethods.has(url.pathname);
      const dispatch=firmable||jobPath.test(url.pathname)||refreshPath.test(url.pathname)||['/search','/company-page'].includes(url.pathname);
      if(!callback&&!dispatch)return reply(404,{error:'Unsupported bridge path'});
      if(!authorized(req.headers.authorization,callback?workerSecret:firmable?appFirmableSecret:appSecret))return reply(401,{error:'Unauthorized'});
      if(dispatch&&req.headers.origin&&req.headers.origin!==appSite)return reply(403,{error:'Unexpected application origin'});
      const methods=callback?['GET','POST']:firmable?[firmableMethods.get(url.pathname)]:jobPath.test(url.pathname)?['GET','POST','DELETE']:refreshPath.test(url.pathname)?['GET','POST']:['POST'];
      if(!methods.includes(req.method))return reply(405,{error:'Method not allowed'});
      const chunks=[];let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>256*1024)return reply(413,{error:'Request too large'});chunks.push(chunk)}
      // The isolated app already has an owned maintenance process. This bridge
      // does not introduce another global background dispatcher on startup.
      if(background&&!production)return reply(200,{ok:true,forwarded:false,maintenance:'existing_isolated_service'});
      const headers=new Headers({'authorization':`Bearer ${callback?appSecret:workerSecret}`});
      for(const[name,value]of Object.entries(req.headers)){
        if(name==='content-type'||name==='x-request-id'||name.startsWith('x-research-')||name.startsWith('x-acquire-native-')){
          if(typeof value==='string')headers.set(name,value);
        }
      }
      const body=Buffer.concat(chunks);
      const destination=(callback?appOrigin:'http://127.0.0.1:8787')+url.pathname+url.search;
      const response=await fetcher(destination,{method:req.method,headers,...(body.length?{body}:{}),redirect:'manual',signal:AbortSignal.timeout(120000)});
      if(response.status>=300&&response.status<400){await response.body?.cancel();return reply(502,{error:'Upstream redirect refused'})}
      const result=Buffer.from(await response.arrayBuffer());
      res.writeHead(response.status,{'content-type':response.headers.get('content-type')||'application/json',...(response.headers.has('retry-after')?{'retry-after':response.headers.get('retry-after')}:{})});res.end(result);
      console.info(JSON.stringify({event:'isolated_bridge_request',direction:callback?'worker_to_app':'app_to_worker',method:req.method,status:response.status}));
    }catch{
      if(!res.headersSent)reply(502,{error:'Isolated research bridge upstream unavailable'});else res.end();
    }
  });
}
