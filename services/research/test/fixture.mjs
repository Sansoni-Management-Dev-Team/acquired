// Synthetic callbacks only: no provider credentials or Acquire database access.
import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
export function fixture(secret) {
  const calls=[];let blockedAction;const pending=[];
  return createServer(async(req,res)=>{
    const reply=(status,body)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body))};
    if(req.headers.authorization!==`Bearer ${secret}`)return reply(401,{error:'Unauthorized'});
    const path=new URL(req.url,'http://localhost').pathname;
    let body;
    try{let text='';for await(const chunk of req){text+=chunk;if(text.length>65536)return reply(413,{})}body=text?JSON.parse(text):{}}catch{return reply(400,{error:'Invalid JSON'})}
    if(path==='/test/calls')return reply(200,calls);
    if(path==='/test/block'&&req.method==='POST'){blockedAction=body.action;return reply(200,{ok:true})}
    if(path==='/test/release'&&req.method==='POST'){blockedAction=undefined;pending.splice(0).forEach(resolve=>resolve());return reply(200,{ok:true})}
    if(!/^\/api\/(research|firmable)\/internal\//.test(path))return reply(404,{});
    calls.push({path,method:req.method,body});
    if(body.action&&body.action===blockedAction)await new Promise(resolve=>pending.push(resolve));
    if(req.method==='GET')return reply(200,{status:'running',deadline:Date.now()+600000,config:{companyBackgroundResearch:true}});
    if(path.endsWith('/timings')||path.endsWith('/background'))return reply(200,{ok:true});
    switch(body.action){
      case 'company':return reply(200,{companyId:'fixture-company'});
      case 'people-page':return reply(200,{found:3,nextOffset:100,complete:true});
      case 'finalize-search':return reply(200,{found:3,nextOffset:3,complete:true});
      case 'profiles':return reply(200,{nextOffset:3,complete:true});
      case 'complete':case 'company-background-research':return reply(200,{complete:true});
      case 'fail':return reply(200,{failed:true});
      default:return reply(400,{error:'Unexpected fixture action'});
    }
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(!process.env.RESEARCH_SERVICE_SECRET)throw Error('Fixture secret required');
  fixture(process.env.RESEARCH_SERVICE_SECRET).listen(3100,'0.0.0.0',()=>console.info('Synthetic callback fixture ready on 3100'));
}
