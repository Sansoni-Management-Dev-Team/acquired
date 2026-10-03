import { classifyAbnMatches, parseAbnSearch, type AbnMatch, type AbnCandidate } from '@/domain/abn-public-lookup.mjs';
import {parseAbnRecord} from '@/domain/abn-resolution.mjs';
export type PublicAbnLookupResult = AbnMatch & { candidates: AbnCandidate[]; searchUrl: string };
// Search and detail reads share capacity and 429 cooldown, independently of browser slots.
export function createPublicAbnClient(fetcher: typeof fetch = fetch, options = { concurrency: 2, spacingMs: 500, timeoutMs: 10000 }) {
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.spacingMs < 0 || options.timeoutMs <= 0) throw new Error('Invalid ABN lookup limits');
  let active=0,nextStart=0;const waiting:Array<()=>void>=[],pending=new Map<string,Promise<string>>();
  async function request(url:string,deadline=Infinity){
    if(active>=options.concurrency)await new Promise<void>(resolve=>waiting.push(resolve));else active++;
    try{const delay=Math.max(0,nextStart-Date.now());nextStart=Math.max(Date.now(),nextStart)+options.spacingMs;if(delay)await new Promise(resolve=>setTimeout(resolve,Math.min(delay,Math.max(0,deadline-Date.now()))));if(Date.now()>=deadline)throw Error('ABN lookup deadline reached');
      const response=await fetcher(url,{signal:AbortSignal.timeout(Math.max(1,Math.min(options.timeoutMs,deadline-Date.now()))),redirect:'error'});
      if(response.status===429){const seconds=Number(response.headers.get('retry-after'));nextStart=Math.max(nextStart,Date.now()+Math.max(30000,Number.isFinite(seconds)?seconds*1000:0));}
      if(!response.ok)throw Error(`ABN public lookup HTTP ${response.status}`);return await response.text();
    }finally{const next=waiting.shift();if(next)next();else active--;}
  }
  function read(url:string,deadline=Infinity){const existing=pending.get(url);if(existing)return existing;const result=request(url,deadline).finally(()=>pending.delete(url));pending.set(url,result);return result;}
  async function search(name:string,deadline=Infinity):Promise<PublicAbnLookupResult>{name=name.trim();if(!name||name.length>160)throw Error('Invalid ABN company name');const searchUrl=`https://abr.business.gov.au/Search/ResultsActive?SearchText=${encodeURIComponent(name)}`;const candidates=parseAbnSearch(await read(searchUrl,deadline));return{...classifyAbnMatches(name,candidates),candidates,searchUrl};}
  async function record(abn:string,deadline=Infinity){if(!/^\d{11}$/.test(abn))throw Error('Invalid ABN');return parseAbnRecord(await read(`https://abr.business.gov.au/ABN/View?abn=${abn}`,deadline),abn);}
  return{search,record};
}
export function createPublicAbnLookup(fetcher:typeof fetch=fetch,options={concurrency:2,spacingMs:500,timeoutMs:10000}){const client=createPublicAbnClient(fetcher,options);return(name:string)=>client.search(name);}
const publicAbnClient=createPublicAbnClient();
export const publicAbnLookup=publicAbnClient.search;
export const publicAbnRecord=publicAbnClient.record;
