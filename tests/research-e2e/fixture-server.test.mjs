import { afterEach, expect, it, vi } from 'vitest';
import { startFixtureServer, fixtureCompletion } from './fixture-server.mjs';
import { createFixtureFetch } from './transport';
const resources=[];
afterEach(async()=>{for(const close of resources.splice(0))await close();});
it('returns grounded deterministic findings and source HTML, retaining no prompts', async()=>{
 const fixture=await startFixtureServer({port:0});resources.push(fixture.close);
 const html=await (await fetch(`${fixture.origin}/fixtures/alpha/`)).text();expect(html).toContain('Alpha Instruments');
 const response=fixtureCompletion({models:['nex-agi/nex-n2.5-pro:free'],messages:[{content:'https://alpha.instruments.example.com/'}],response_format:{json_schema:{schema:{properties:{findings:{items:{properties:{kind:{enum:['company','product']}}}}}}}}});
 expect(JSON.parse(response.choices[0].message.content).findings[0]).toMatchObject({kind:'company',quote:'Alpha Instruments designs and manufactures precision industrial sensors in Victoria, Australia.'});
 expect(await (await fetch(`${fixture.origin}/__events`)).json()).not.toHaveProperty('messages');
});
it('blocks all unmatched outbound fetches and redirects without provider requests',async()=>{
 const fixture=await startFixtureServer({port:0});resources.push(fixture.close);
 const native=async()=>new Response(null,{status:302,headers:{location:'https://outside.example'}});
 const transport=createFixtureFetch({E2E_FIXTURE_ORIGIN:fixture.origin,APP_ORIGIN:'http://127.0.0.1:18120',E2E_READER_ORIGIN:'http://127.0.0.1:18125'},native);
 await expect(transport('https://outside.example/')).rejects.toThrow(/blocked/);
 await expect(transport('https://openrouter.ai/api/v1/chat/completions', {method:'POST'})).rejects.toThrow(/redirect/i);
});
it('routes provider calls only to fixtures and captures acknowledged callbacks without secrets',async()=>{
 const fixture=await startFixtureServer({port:0});resources.push(fixture.close);
 const calls=[];const native=async(input,init)=>{const url=new URL(String(input));calls.push(url.href);if(url.origin==='http://127.0.0.1:18120')return Response.json({ok:true,timingAcceptedIds:['timing-id']});return fetch(input,init);};
 const transport=createFixtureFetch({E2E_FIXTURE_ORIGIN:fixture.origin,APP_ORIGIN:'http://127.0.0.1:18120',E2E_READER_ORIGIN:'http://127.0.0.1:18125'},native);
 await transport('http://127.0.0.1:18120/api/research/internal/00000000-0000-4000-8000-000000000001',{method:'POST',body:JSON.stringify({revision:2,status:'crawling',timingSpans:[{id:'timing-id',private:'secret'}],page:{markdown:'private prompt',findings:[{}]}})});
 const recorded=await(await fetch(`${fixture.origin}/__events`)).json();expect(JSON.stringify(recorded)).not.toMatch(/secret|private prompt/);expect(recorded.events).toContainEqual(expect.objectContaining({revision:2,pageFindingCount:1,acceptedTimingIds:['timing-id']}));
});
it('drops one acknowledged progress response and gates/reopens selected website pages',async()=>{
 const fixture=await startFixtureServer({port:0});resources.push(fixture.close);
 const jobId='00000000-0000-4000-8000-000000000001';
 await fetch(`${fixture.origin}/__control`,{method:'POST',body:JSON.stringify({dropProgressResponseOnceJobId:jobId,blockedSlugs:['gamma']})});
 const native=async(input,init)=>new URL(String(input)).origin==='http://127.0.0.1:18120'?Response.json({ok:true,timingAcceptedIds:[]}):fetch(input,init);
 const transport=createFixtureFetch({E2E_FIXTURE_ORIGIN:fixture.origin,APP_ORIGIN:'http://127.0.0.1:18120'},native);
 await expect(transport(`http://127.0.0.1:18120/api/research/internal/${jobId}`,{method:'POST',body:JSON.stringify({revision:0,status:'crawling'})})).resolves.toBeInstanceOf(Response);
 await expect(transport(`http://127.0.0.1:18120/api/research/internal/${jobId}`,{method:'POST',body:JSON.stringify({revision:1,status:'crawling',page:{findings:[{}]}})})).rejects.toThrow(/lost progress/i);
 await expect(transport(`http://127.0.0.1:18120/api/research/internal/${jobId}`,{method:'POST',body:JSON.stringify({revision:1,status:'crawling',page:{findings:[{}]}})})).resolves.toBeInstanceOf(Response);
 let finished=false;const gated=fetch(`${fixture.origin}/fixtures/gamma/`).then(response=>{finished=true;return response;});
 await vi.waitFor(async()=>expect((await(await fetch(`${fixture.origin}/__events`)).json()).counters.page).toBe(1));expect(finished).toBe(false);await fetch(`${fixture.origin}/__control`,{method:'POST',body:JSON.stringify({blockedSlugs:[]})});expect((await gated).ok).toBe(true);
});

it('injects a failed telemetry delivery once and retains the acknowledged IDs on retry',async()=>{
 const fixture=await startFixtureServer({port:0});resources.push(fixture.close);
 const jobId='00000000-0000-4000-8000-000000000001';let appRequests=0;
 await fetch(`${fixture.origin}/__control`,{method:'POST',body:JSON.stringify({timingFailureOnceJobId:jobId})});
 const native=async(input,init)=>{if(new URL(String(input)).origin==='http://127.0.0.1:18120'){appRequests++;return Response.json({ok:true,timingAcceptedIds:['timing-123']});}return fetch(input,init);};
 const transport=createFixtureFetch({E2E_FIXTURE_ORIGIN:fixture.origin,APP_ORIGIN:'http://127.0.0.1:18120'},native);
 const request={method:'POST',body:JSON.stringify({spans:[{id:'timing-123'}]})};
 expect((await transport(`http://127.0.0.1:18120/api/research/internal/${jobId}/timings`,request)).status).toBe(503);
 expect(appRequests).toBe(0);
 expect((await transport(`http://127.0.0.1:18120/api/research/internal/${jobId}/timings`,request)).status).toBe(200);
 expect(appRequests).toBe(1);
 const events=(await(await fetch(`${fixture.origin}/__events`)).json()).events;
 expect(events).toContainEqual(expect.objectContaining({phase:'after',timingAcceptedIds:['timing-123']}));
});

it('loses one piggyback telemetry batch without losing durable progress or accepting its IDs',async()=>{
 const fixture=await startFixtureServer({port:0});resources.push(fixture.close);
 const jobId='00000000-0000-4000-8000-000000000001',requests=[];
 await fetch(`${fixture.origin}/__control`,{method:'POST',body:JSON.stringify({timingFailureOnceJobId:jobId})});
 const native=async(input,init)=>{if(new URL(String(input)).origin==='http://127.0.0.1:18120'){const body=JSON.parse(init.body);requests.push(body);return Response.json({ok:true,timingAcceptedIds:body.timingSpans?.map(span=>span.id)||[]});}return fetch(input,init);};
 const transport=createFixtureFetch({E2E_FIXTURE_ORIGIN:fixture.origin,APP_ORIGIN:'http://127.0.0.1:18120'},native);
 const request={method:'POST',body:JSON.stringify({revision:1,status:'crawling',timingSpans:[{id:'timing-123'}],page:{findings:[{}]}})};
 const first=await(await transport(`http://127.0.0.1:18120/api/research/internal/${jobId}`,request)).json();
 expect(first.timingAcceptedIds).toEqual([]);expect(requests[0].revision).toBe(1);expect(requests[0]).not.toHaveProperty('timingSpans');expect(requests[0].page.findings).toHaveLength(1);
 const retry=await(await transport(`http://127.0.0.1:18120/api/research/internal/${jobId}`,request)).json();expect(retry.timingAcceptedIds).toEqual(['timing-123']);
 expect((await(await fetch(`${fixture.origin}/__events`)).json()).events).toContainEqual(expect.objectContaining({jobId,timingFailure:true}));
});
it('matches targeted company queries while generic discovery retains all fixture candidates',async()=>{
 const fixture=await startFixtureServer({port:0});resources.push(fixture.close);
 for(const query of ['"beta.instruments.example.com" employees','"Beta Instruments" managing director']) {
  const html=await(await fetch(`${fixture.origin}/fixtures/search?q=${encodeURIComponent(query)}`)).text();
  expect(html).toContain('https://beta.instruments.example.com/');expect(html).not.toContain('https://alpha.instruments.example.com/');expect(html).not.toContain('https://gamma.instruments.example.com/');
 }
 const generic=await(await fetch(`${fixture.origin}/fixtures/search?q=industrial+sensors+Australia`)).text();
 for(const slug of ['alpha','beta','gamma'])expect(generic).toContain(`https://${slug}.instruments.example.com/`);
});
it('extracts the supplied source company independently of unrelated planner context',()=>{
 const response=fixtureCompletion({messages:[{content:'Previously discovered https://alpha.instruments.example.com/'},{content:JSON.stringify({companyDomain:'alpha.instruments.example.com',source:'https://beta.instruments.example.com/',webpage:'Beta Instruments'})}],response_format:{json_schema:{schema:{properties:{findings:{items:{properties:{kind:{enum:['company','product']}}}}}}}}});
 expect(JSON.parse(response.choices[0].message.content).findings[0]).toMatchObject({name:'Beta Instruments',website:'https://beta.instruments.example.com/'});
});
