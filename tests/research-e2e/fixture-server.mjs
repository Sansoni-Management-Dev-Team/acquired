/** Test-only, deterministic providers. No external requests or credential storage. */
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
export const COMPANIES = ['alpha', 'beta', 'gamma'];
const title = slug => `${slug[0].toUpperCase()}${slug.slice(1)} Instruments`;
const home = slug => `https://${slug}.instruments.example.com/`;
const director = slug => ({alpha:'Alex Taylor',beta:'Blake Morgan',gamma:'Casey Jordan'})[slug];
const companyQuote = slug => `${title(slug)} designs and manufactures precision industrial sensors in Victoria, Australia.`;
const peopleQuote = slug => `${director(slug)} is Managing Director of ${title(slug)}. Contact ${slug}@${slug}.instruments.example.com.`;
export function fixtureHtml(slug) {
 if(!COMPANIES.includes(slug))throw new Error('Unknown fixture company');
 return `<!doctype html><html><head><title>${title(slug)}</title></head><body><h1>${title(slug)}</h1><p>${companyQuote(slug)}</p><p>We manufacture industrial sensors and precision instrumentation for Australian manufacturing customers.</p><p>We have 18 employees. Our annual revenue is AUD 3 million. We were founded in 2001.</p><p>${peopleQuote(slug)}</p><a href="${home(slug)}about">About us</a> <a href="${home(slug)}team">Our team</a> <a href="mailto:${slug}@${slug}.instruments.example.com">Email our managing director</a><p>ABN: ${{alpha:'99000000000',beta:'99000000032',gamma:'99000000064'}[slug]}</p></body></html>`;
}
export function fixtureSearchHtml(query='') {
 const match=query.match(/\b(alpha|beta|gamma)(?:\.instruments\.example\.com|\s+instruments)\b/i);
 const companies=match?[match[1].toLowerCase()]:COMPANIES;
 return `<!doctype html><html><body>${companies.map(slug=>`<article><h2><a href="${home(slug)}">${title(slug)} precision industrial sensor manufacturer</a></h2><p><a href="${home(slug)}">${companyQuote(slug)}</a></p></article>`).join('\n')}</body></html>`;
}
export function fixtureCompletion(input) {
 const schema=input.response_format?.json_schema?.schema || input.response_format?.json_schema || {};
 const props=schema.properties || {};
 const content=(input.messages || []).map(message=>String(message.content || '')).join('\n');
 let source,page;try{const context=JSON.parse(input.messages?.at(-1)?.content || '{}');source=context.sourceUrl || context.source;page=context.webpage;}catch{/* Plain deterministic test input. */}
 const sourceContext=typeof source==='string'?source:String(input.messages?.at(-1)?.content || content);
 const slug=COMPANIES.find(company=>sourceContext.includes(`${company}.instruments.example.com`)) || 'alpha';
 const identityQuote=(typeof page==='string'?page:sourceContext).split('\n').find(line=>/^#{1,2} +/.test(line)&&line.replace(/^#{1,2} +/,'').trim()===title(slug))?.trim() || companyQuote(slug);
 let result;
 if(props.findings) {
  const allowed=props.findings.items?.properties?.kind?.enum || [];
  const finding=(kind,name,value,quote,relevance='unclear',extra={})=>({kind,name,value,quote,website:home(slug),relevance,...extra});
  result={findings:allowed.includes('company') ? [finding('company',title(slug),title(slug),identityQuote,'relevant'),finding('business_role',title(slug),'manufacturer','We manufacture industrial sensors and precision instrumentation for Australian manufacturing customers.','relevant'),finding('product','Industrial sensors','Industrial sensors','We manufacture industrial sensors and precision instrumentation for Australian manufacturing customers.','relevant')] : [finding('person',director(slug),'Managing Director',peopleQuote(slug),'unclear',{email:`${slug}@${slug}.instruments.example.com`})]};
  if(allowed.includes('company')&&allowed.includes('person')&&content.includes('Also capture a named owner'))result.findings.push(finding('person',director(slug),'Managing Director',peopleQuote(slug),'unclear',{email:`${slug}@${slug}.instruments.example.com`}));
 } else if(props.decisions || props.query) {
  let context={};try{context=JSON.parse(input.messages.at(-1).content);}catch{/* deterministic default */}
  const start=context.attempts?.length || 0;
  const decision=index=>({query:`precision industrial sensors manufacturer branch ${start+index+1}`,region:context.regions?.[index % Math.max(1,context.regions?.length || 1)] || 'Victoria',reason:'Explore deterministic instrument manufacturers',stop:false});
  result=props.decisions ? {decisions:[decision(0),decision(1),decision(2)]} : decision(0);
 } else if(props.choice) result={choice:props.choice.enum?.find(choice=>choice==='stop') || props.choice.enum?.[0] || 'stop'};
 else if(props.value && props.quote) result={value:'18',quote:'We have 18 employees.'};
 else throw new Error('Unsupported fixture extraction schema');
 return {model:input.models?.[0] || 'nex-agi/nex-n2.5-pro:free',choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}],usage:{prompt_tokens:20,completion_tokens:20,cost:0}};
}
const safeId=value=>typeof value==='string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value) ? value : undefined;
export function safeEvent(input) {
 const event={};
 for(const key of ['jobId','requestId','action','phase','status','event']){const value=safeId(input?.[key]);if(value!==undefined)event[key]=value;}
 for(const key of ['revision','pages','modelCalls','timingCount','acceptedTimingCount','pageFindingCount','httpStatus']){const value=input?.[key];if(Number.isInteger(value)&&value>=0&&value<=1000000)event[key]=value;}
 if(Array.isArray(input?.acceptedTimingIds))event.acceptedTimingIds=input.acceptedTimingIds.map(safeId).filter(Boolean).slice(0,64);
 for(const key of ['timingFailure'])if(typeof input?.[key]==='boolean')event[key]=input[key];
 return event;
}
export async function startFixtureServer({port=Number(process.env.E2E_FIXTURE_PORT || 18124),host='127.0.0.1'}={}) {
 let control={blockedSlugs:[]}, events=[], counters={openrouter:0,page:0,search:0,callback:0,blockedOutbound:0};
 const waiting=new Map();
 const release=()=>{for(const [slug,resolvers] of waiting)if(!control.blockedSlugs.includes(slug)){waiting.delete(slug);for(const resolve of resolvers)resolve();}};
 const json=(response,status,data)=>{response.writeHead(status,{'content-type':'application/json'});response.end(JSON.stringify(data));};
 const body=async request=>{let text='';for await(const chunk of request){text+=chunk;if(text.length>1000000)throw new Error('Payload too large');}return text?JSON.parse(text):{};};
 const server=createServer(async(request,response)=>{
  try {
   const url=new URL(request.url,'http://fixture.invalid');
   if(url.pathname==='/health')return json(response,200,{ok:true,testOnly:true});
   if(url.pathname==='/__control' && request.method==='POST'){
    const input=await body(request);
    if(input.reset){control={blockedSlugs:[]};release();events=[];counters={openrouter:0,page:0,search:0,callback:0,blockedOutbound:0};}
    if(Array.isArray(input.blockedSlugs))control.blockedSlugs=input.blockedSlugs.filter(slug=>COMPANIES.includes(slug));
    for(const key of ['dropProgressResponseOnceJobId','timingFailureOnceJobId'])if(input[key]!==undefined)control[key]=safeId(input[key]);
    if(Number.isInteger(input.openrouterStatusOnce)&&input.openrouterStatusOnce>=400&&input.openrouterStatusOnce<=599)control.openrouterStatusOnce=input.openrouterStatusOnce;
    release();return json(response,200,{ok:true,control});
   }
   if(url.pathname==='/__events' && request.method==='GET')return json(response,200,{events,counters,control});
   if(url.pathname==='/__events' && request.method==='POST'){
    const event=safeEvent(await body(request));events.push(event);if(events.length>10000)events.shift();
    if(event.phase==='after')counters.callback++;
    if(event.event==='outbound_blocked')counters.blockedOutbound++;
    if(event.acceptedTimingIds)event.timingAcceptedIds=event.acceptedTimingIds;
    const dropProgressResponse=event.phase==='after' && event.httpStatus===200 && event.revision!==undefined && event.pageFindingCount>0 && event.jobId===control.dropProgressResponseOnceJobId;
    const timingFailure=event.phase==='before' && (event.action==='timings' || (event.action==='progress' && event.timingCount>0)) && event.jobId===control.timingFailureOnceJobId;
    if(dropProgressResponse){event.dropProgressResponse=true;delete control.dropProgressResponseOnceJobId;}
    if(timingFailure){event.timingFailure=true;delete control.timingFailureOnceJobId;}
    return json(response,200,{dropProgressResponse,timingFailure});
   }
   if(url.pathname==='/openrouter' && request.method==='POST'){
    counters.openrouter++;const input=await body(request);
    if(control.openrouterStatusOnce){const status=control.openrouterStatusOnce;delete control.openrouterStatusOnce;return json(response,status,{error:{code:status}});}
    return json(response,200,fixtureCompletion(input));
   }
   if(url.pathname==='/robots.txt'){response.writeHead(200,{'content-type':'text/plain'});return response.end('User-agent: *\nAllow: /\n');}
   if(url.pathname==='/fixtures/search'){counters.search++;response.writeHead(200,{'content-type':'text/html'});return response.end(fixtureSearchHtml(url.searchParams.get('q') || ''));}
   const match=url.pathname.match(/^\/fixtures\/(alpha|beta|gamma)(?:\/.*)?$/);
   if(match){
    const slug=match[1];counters.page++;
    if(control.blockedSlugs.includes(slug))await new Promise(resolve=>{const listeners=waiting.get(slug)||[];listeners.push(resolve);waiting.set(slug,listeners);response.once('close',resolve);});
    if(response.destroyed)return;
    if(url.pathname.endsWith('/robots.txt')){response.writeHead(200,{'content-type':'text/plain'});return response.end(`User-agent: *\nAllow: /\nSitemap: ${home(slug)}sitemap.xml\n`);}
    if(url.pathname.endsWith('/sitemap.xml')){response.writeHead(200,{'content-type':'application/xml'});return response.end(`<urlset><url><loc>${home(slug)}team</loc></url><url><loc>${home(slug)}about</loc></url></urlset>`);}
    response.writeHead(200,{'content-type':'text/html'});return response.end(fixtureHtml(slug));
   }
   return json(response,404,{error:'Unknown fixture path'});
  }catch{json(response,400,{error:'Invalid fixture request'});}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
 return {origin:`http://127.0.0.1:${server.address().port}`,close:async()=>{control.blockedSlugs=[];release();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){const fixture=await startFixtureServer({host:process.env.E2E_FIXTURE_BIND || '0.0.0.0'});console.info(JSON.stringify({event:'fixture-ready',origin:fixture.origin,testOnly:true}));}
