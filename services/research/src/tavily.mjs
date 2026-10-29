import {createHash,timingSafeEqual} from 'node:crypto';
import {publicResearchUrl} from '../../../src/domain/research.ts';
import {withLocalProvider} from '../../../cloudflare/research/local-provider.ts';
const failure=(category,status=502)=>Object.assign(Error(`Research provider unavailable (${category})`),{category,status});

export function createTavily({apiKey,fetcher=fetch,onEvent=()=>{}}) {
  if(!apiKey)throw Error('Tavily API key required');
  const call=async(operation,body)=>{
    const started=Date.now();let response,data;
    try{
      response=await fetcher(`https://api.tavily.com/${operation}`,{method:'POST',headers:{authorization:`Bearer ${apiKey}`,'content-type':'application/json'},body:JSON.stringify(body),redirect:'manual',signal:AbortSignal.timeout(30000)});
      if(!response.ok){
        const limited=[432,433].includes(response.status);
        throw Object.assign(failure(limited?'provider_usage_limit':response.status===429?'rate_limited':[401,403].includes(response.status)?'provider_authentication':'provider_error',limited?402:response.status===429?429:502),{upstreamStatus:response.status});
      }
      data=await response.json();
      return data;
    }catch(error){if(error.category)throw error;throw failure('provider_transport_or_response_error')}
    finally{onEvent({provider:'tavily',operation,httpStatus:response?.status,elapsedMs:Date.now()-started,...(typeof data?.request_id==='string'?{providerRequestId:data.request_id.slice(0,100)}:{})})}
  };
  return {
    async search(query) {
      if(typeof query!=='string'||query.trim().length<2||query.length>500)throw failure('invalid_query',400);
      const data=await call('search',{query,search_depth:'basic',max_results:10,include_answer:false,include_raw_content:false,auto_parameters:false});
      if(!Array.isArray(data.results))throw failure('invalid_search_response');
      const results=data.results.flatMap(row=>{const url=typeof row?.url==='string'&&publicResearchUrl(row.url);return url&&typeof row.title==='string'&&typeof row.content==='string'?[{url,title:row.title.slice(0,300),snippet:row.content.slice(0,1200)}]:[]}).slice(0,10);
      return {results,seeds:results.map(row=>row.url).slice(0,6),provider:'tavily'};
    },
    async read(url) {
      if(typeof url!=='string'||!publicResearchUrl(url))throw Object.assign(failure('unsupported_public_url',400),{message:'Unsupported public URL'});
      const data=await call('extract',{urls:[url],extract_depth:'basic',format:'markdown',include_images:false,timeout:20});
      const result=data.results?.[0],finalUrl=typeof result?.url==='string'&&publicResearchUrl(result.url);
      if(!finalUrl||typeof result.raw_content!=='string'||!result.raw_content.trim())throw failure('page_unavailable');
      return {url:finalUrl,markdown:result.raw_content.slice(0,30000),provider:'tavily'};
    },
  };
}
export function providerFailureResponse(error) {
  return Response.json({error:'Research provider unavailable',category:error.category||'provider_error',provider:'tavily',...(error.upstreamStatus?{upstreamStatus:error.upstreamStatus}:{})},{status:error.status||502});
}
export async function tavilySearchResponse(request,env,coordinator,fetcher=fetch) {
  const hash=value=>createHash('sha256').update(value).digest();
  if(!timingSafeEqual(hash(request.headers.get('authorization')||''),hash(`Bearer ${env.SERVICE_SECRET}`)))return Response.json({error:'Unauthorized'},{status:401});
  if(request.method!=='POST')return Response.json({error:'Use POST'},{status:405});
  // Native provider receipts are not implemented in this local adapter. Refuse
  // explicit native context rather than bypass its budget/receipt boundary.
  if([...request.headers.keys()].some(key=>key.startsWith('x-acquire-native-')))return Response.json({error:'Native search requires its receipt adapter'},{status:422});
  const jobId=request.headers.get('x-research-job-id');
  if(!/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(jobId||''))return Response.json({error:'Research job required'},{status:400});
  const body=await request.json().catch(()=>null);
  if(typeof body?.query!=='string'||body.query.trim().length<2||body.query.length>500)return Response.json({error:'Invalid search query'},{status:400});
  if(body.page!==undefined&&body.page!==1||body.engine!==undefined)return Response.json({error:'Tavily supports this service search contract on page 1 without an engine override'},{status:422});
  const provider=createTavily({apiKey:env.TAVILY_API_KEY,fetcher,onEvent:event=>console.info('research-provider',JSON.stringify({...event,jobId}))});
  try{
    const result=await withLocalProvider('search',request.headers.get('x-research-browser-reservation')||undefined,body=>{
      if(body.action==='provider-reserve')return coordinator.reserve({jobId,token:body.token,provider:'search',local:true,holdMs:20000});
      if(body.action==='browser-permit')return coordinator.claim(jobId,body.token);
      return coordinator.release(jobId,body.token);
    },()=>provider.search(body.query));
    return Response.json(result);
  }catch(error){return providerFailureResponse(error)}
}
