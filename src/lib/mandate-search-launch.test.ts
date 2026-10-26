import {beforeEach,expect,it,vi} from 'vitest';
import {emptyBrief} from '@/domain/acquisition';
import {stageMandateSearch,readMandateSearch,continueMandateSearch,mandateSearchHref} from './mandate-search-launch';
const id='10000000-0000-4000-8000-000000000001';
let storage:Storage;
beforeEach(()=>{const map=new Map<string,string>();storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>{map.set(k,v);},removeItem:k=>{map.delete(k);},clear:()=>map.clear(),key:()=>null,length:0};});
const input={requestId:id,preset:'live-research-test' as const,presentation:'workspace' as const,description:'Commercial maintenance companies in Queensland.'};
const saved={id,mandateId:id,preset:input.preset,presentation:input.presentation,state:'accepted',revision:1};
it('stages a stable pending mandate URL before any provider or admission request',()=>{
 const staged=stageMandateSearch(input,storage);expect(readMandateSearch(id,storage)).toEqual(staged);expect(mandateSearchHref(id)).toBe(`/mandates/${id}?tab=search+enrich`);
});
it('shares a deferred generation across mounts and freezes its exact admission body before posting',async()=>{
 stageMandateSearch(input,storage);let generate!:(r:Response)=>void;const fetcher=vi.fn(async(url:string)=>url.includes('?requestId=')?Response.json({status:'missing'}):url.endsWith('/generate')?await new Promise<Response>(resolve=>{generate=resolve;}):Response.json(saved));
 const a=continueMandateSearch(id,storage,fetcher as never),b=continueMandateSearch(id,storage,fetcher as never);await vi.waitFor(()=>expect(fetcher.mock.calls.some(([u])=>u.endsWith('/generate'))).toBe(true));
 expect(fetcher.mock.calls.filter(([u])=>u.endsWith('/generate'))).toHaveLength(1);generate(Response.json({brief:emptyBrief()}));expect(await a).toEqual(saved);expect(await b).toEqual(saved);
 expect(fetcher.mock.calls.filter(([u])=>u==='/api/acquisition-workflows')).toHaveLength(1);
});
it('a receipt found after refresh wins before generation or another admission',async()=>{
 stageMandateSearch(input,storage);const fetcher=vi.fn().mockResolvedValue(Response.json(saved));expect(await continueMandateSearch(id,storage,fetcher)).toEqual(saved);expect(fetcher).toHaveBeenCalledOnce();
});
it('keeps the original generated body across an uncertain admission and retries it without regeneration',async()=>{
 stageMandateSearch(input,storage);const first=vi.fn(async(url:string)=>url.endsWith('/generate')?Response.json({brief:emptyBrief()}):url.includes('?requestId=')?Response.json({status:'missing'}):new Response('',{status:503}));
 await expect(continueMandateSearch(id,storage,first as never)).rejects.toThrow();const body=readMandateSearch(id,storage)!.requestBody;expect(body).toBeDefined();
 const second=vi.fn(async(url:string,options?:RequestInit)=>{void options;return url.includes('?requestId=')?Response.json({status:'missing'}):Response.json(saved);});expect(await continueMandateSearch(id,storage,second as never)).toEqual(saved);expect(second.mock.calls.some(([u])=>u.endsWith('/generate'))).toBe(false);expect(second.mock.calls.find(([u])=>u==='/api/acquisition-workflows')?.[1]).toMatchObject({body});
});
it('does not generate or admit after an unavailable ownership/receipt check',async()=>{
 stageMandateSearch(input,storage);const fetcher=vi.fn().mockResolvedValue(Response.json({error:'Unavailable'},{status:503}));await expect(continueMandateSearch(id,storage,fetcher)).rejects.toThrow();expect(fetcher).toHaveBeenCalledOnce();
});

it('does not generate when shared workflows report disabled rather than a missing owned receipt',async()=>{
 stageMandateSearch(input,storage);const fetcher=vi.fn().mockResolvedValue(Response.json({error:'Shared workflows are unavailable.'},{status:404}));
 await expect(continueMandateSearch(id,storage,fetcher)).rejects.toThrow();expect(fetcher).toHaveBeenCalledOnce();
});
