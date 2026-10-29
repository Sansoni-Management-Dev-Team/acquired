import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTavily,tavilySearchResponse} from '../dist/tavily.mjs';

test('Tavily keeps the complete query, fixed request bounds and public source URLs',async()=>{
 let request;
 const provider=createTavily({apiKey:'private',fetcher:async(url,options)=>{request={url,options,body:JSON.parse(options.body)};return Response.json({results:[{url:'https://www.vendor.com.au/aged-care/',title:'Vendor',content:'Aged care software'},{url:'http://127.0.0.1/private',title:'Private',content:'No'}]})}});
 const result=await provider.search('"aged care" software implementation Australia');
 assert.equal(request.url,'https://api.tavily.com/search');assert.equal(request.options.headers.authorization,'Bearer private');assert.equal(request.body.query,'"aged care" software implementation Australia');assert.equal(request.body.search_depth,'basic');assert.equal(request.body.max_results,10);assert.equal(request.options.redirect,'manual');
 assert.deepEqual(result.results,[{url:'https://www.vendor.com.au/aged-care/',title:'Vendor',snippet:'Aged care software'}]);assert.equal(result.provider,'tavily');
});
test('extraction preserves the source and rejects private URLs or failed results',async()=>{
 let calls=0;
 const provider=createTavily({apiKey:'private',fetcher:async()=>{calls++;return Response.json({results:[{url:'https://www.vendor.com.au/aged-care/',raw_content:'We supply aged care software.'}]})}});
 assert.deepEqual(await provider.read('https://www.vendor.com.au/aged-care/'),{url:'https://www.vendor.com.au/aged-care/',markdown:'We supply aged care software.',provider:'tavily'});
 await assert.rejects(provider.read('http://127.0.0.1/'),/Unsupported/);assert.equal(calls,1);
 const failed=createTavily({apiKey:'private',fetcher:async()=>Response.json({results:[],failed_results:[{error:'raw private provider diagnostic'}]})});
 await assert.rejects(failed.read('https://vendor.com.au/'),e=>e.category==='page_unavailable'&&!e.message.includes('private'));
});
test('provider errors do not trigger automatic retries or leak response text',async()=>{
 let calls=0;const provider=createTavily({apiKey:'private',fetcher:async()=>{calls++;return Response.json({error:'private provider details'},{status:429})}});
 await assert.rejects(provider.search('aged care software'),e=>e.status===429&&e.category==='rate_limited'&&!e.message.includes('private'));assert.equal(calls,1);
});
test('search route authenticates and refuses unsupported native/page routing before provider calls',async()=>{
 let calls=0;const env={SERVICE_SECRET:'service',TAVILY_API_KEY:'private'};
 const request=(headers,body={query:'aged care software'})=>new Request('http://localhost/search',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
 const fetcher=async()=>{calls++;return Response.json({results:[]})};
 assert.equal((await tavilySearchResponse(request({}),env,{},fetcher)).status,401);
 const headers={authorization:'Bearer service','x-research-job-id':'11111111-1111-4111-8111-111111111111'};
 assert.equal((await tavilySearchResponse(request(headers,{query:'aged care software',page:2}),env,{},fetcher)).status,422);
 assert.equal((await tavilySearchResponse(request({...headers,'x-acquire-native-research-job':headers['x-research-job-id']}),env,{},fetcher)).status,422);assert.equal(calls,0);
});
test('search route consumes and releases the original workflow reservation',async()=>{
 const calls=[];const coordinator={claim:async(_job,token)=>{calls.push(['claim',token]);return{granted:true}},release:async(_job,token)=>calls.push(['release',token])};
 const request=new Request('http://localhost/search',{method:'POST',headers:{authorization:'Bearer service','x-research-job-id':'11111111-1111-4111-8111-111111111111','x-research-browser-reservation':'workflow-token'},body:JSON.stringify({query:'aged care software'})});
 const result=await tavilySearchResponse(request,{SERVICE_SECRET:'service',TAVILY_API_KEY:'private'},coordinator,async()=>Response.json({results:[]}));assert.equal(result.status,200);assert.deepEqual(calls,[['claim','workflow-token'],['release','workflow-token']]);
});

test('Tavily account usage limits surface distinctly and are never retried',async()=>{
 let calls=0;const provider=createTavily({apiKey:'private',fetcher:async()=>{calls++;return Response.json({detail:{error:'account plan cap'}},{status:432})}});
 await assert.rejects(provider.search('aged care software'),e=>e.category==='provider_usage_limit'&&e.status===402&&e.upstreamStatus===432);assert.equal(calls,1);
});
