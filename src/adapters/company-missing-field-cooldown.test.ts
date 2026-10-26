import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {createCompanyMissingFieldResearch, createMissingFieldCrawlReader} from './company-missing-field-research';

const website='https://synthetic.example.com/';
const input={name:'Synthetic',website,missingFields:['company_emails' as const],maxPages:1};
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(0);vi.spyOn(console,'info').mockImplementation(()=>{});});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});

it('preserves safe reader cooldown metadata and Retry-After without exposing upstream text',async()=>{
 const read=createMissingFieldCrawlReader({LOCAL_DEVELOPMENT:'true'},async()=>Response.json({category:'domain_backoff',error:'private reader body'},{status:429,headers:{'Retry-After':'3'}}));
 await expect(read(website,10000)).rejects.toMatchObject({category:'domain_backoff',status:429,retryAfterMs:3000});
 await expect(read(website,10000)).rejects.not.toThrow('private reader body');
});

it('waits out the three-second domain cooldown, then reads the same URL using one page allowance',async()=>{
 const calls:number[]=[];
 const fetcher=vi.fn(async()=>{calls.push(Date.now());return Date.now()<3000
  ?Response.json({category:'domain_backoff'},{status:429,headers:{'Retry-After':'3'}})
  :Response.json({url:website,html:'<footer>office@synthetic.example.com</footer>',only_main_content:false});});
 const pending=createCompanyMissingFieldResearch({readPage:createMissingFieldCrawlReader({LOCAL_DEVELOPMENT:'true'},fetcher)})({...input,deadline:10000});
 await vi.advanceTimersByTimeAsync(2999);
 expect(calls).toEqual([0]);
 await vi.advanceTimersByTimeAsync(1);
 const result=await pending;
 expect(calls).toEqual([0,3000]);
 expect(result.fields.company_emails?.status).toBe('reported');
 expect(result.attempts).toContainEqual(expect.objectContaining({status:'deferred',category:'domain_backoff',retryAfterMs:3000,pageReadStarted:false}));
 expect(vi.getTimerCount()).toBe(0);
});

it('leaves a deferred URL eligible when later field search finds it after discovery admission expired',async()=>{
 const calls:number[]=[];
 const readPage=createMissingFieldCrawlReader({LOCAL_DEVELOPMENT:'true'},async()=>{
  calls.push(Date.now());return calls.length===1
   ?Response.json({category:'reader_busy'},{status:429,headers:{'Retry-After':'50'}})
   :Response.json({url:website,html:'<footer>office@synthetic.example.com</footer>',only_main_content:false});
 });
 const result=await createCompanyMissingFieldResearch({readPage,search:async()=>{vi.setSystemTime(50000);return[{url:website}];}})({...input,deadline:100000});
 expect(calls).toEqual([0,50000]);
 expect(result.fields.company_emails?.status).toBe('reported');
 expect(vi.getTimerCount()).toBe(0);
});

it('does not retry past the original deadline or report a busy reader as undisclosed company data',async()=>{
 const fetcher=vi.fn(async()=>Response.json({category:'reader_busy'},{status:429,headers:{'Retry-After':'3'}}));
 const result=await createCompanyMissingFieldResearch({readPage:createMissingFieldCrawlReader({LOCAL_DEVELOPMENT:'true'},fetcher),search:async()=>[]})({...input,deadline:3000});
 expect(fetcher).toHaveBeenCalledOnce();
 expect(result.facts).toEqual([]);
 expect(result.fields.company_emails?.status).toBe('research_incomplete');
 expect(result.attempts).toContainEqual(expect.objectContaining({category:'reader_busy',retryAfterMs:3000,pageReadStarted:false}));
 expect(vi.getTimerCount()).toBe(0);
});

it('does not treat an origin rate limit as an unstarted reader admission',async()=>{
 const fetcher=vi.fn(async()=>Response.json({category:'origin_rate_limit'},{status:429,headers:{'Retry-After':'3'}}));
 const result=await createCompanyMissingFieldResearch({readPage:createMissingFieldCrawlReader({LOCAL_DEVELOPMENT:'true'},fetcher)})({...input,deadline:10000});
 expect(fetcher).toHaveBeenCalledOnce();
 expect(result.fields.company_emails?.status).toBe('research_incomplete');
 expect(result.attempts.some(attempt=>attempt.status==='deferred')).toBe(false);
 expect(vi.getTimerCount()).toBe(0);
});

it('bounds repeated busy responses by the original deadline and leaves no retry timer behind',async()=>{
 const calls:number[]=[];
 const fetcher=vi.fn(async()=>{calls.push(Date.now());return Response.json({category:'reader_busy'},{status:429,headers:{'Retry-After':'3'}});});
 const pending=createCompanyMissingFieldResearch({readPage:createMissingFieldCrawlReader({LOCAL_DEVELOPMENT:'true'},fetcher)})({...input,deadline:7000});
 await vi.advanceTimersByTimeAsync(7000);
 const result=await pending;
 expect(calls).toEqual([0,3000,6000]);
 expect(result.fields.company_emails?.status).toBe('research_incomplete');
 expect(vi.getTimerCount()).toBe(0);
});

it('does not confuse a recovered queue delay with failure to retrieve a published field',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(Response.json({category:'domain_backoff'},{status:429,headers:{'Retry-After':'3'}}))
  .mockImplementation(async()=>Response.json({url:website,html:'<p>Published services, no email</p>',only_main_content:false}));
 const pending=createCompanyMissingFieldResearch({readPage:createMissingFieldCrawlReader({LOCAL_DEVELOPMENT:'true'},fetcher),search:async()=>[]})({...input,maxPages:8,deadline:10000});
 await vi.advanceTimersByTimeAsync(3000);
 const result=await pending;
 expect(result.fields.company_emails?.status).toBe('not_disclosed');
 expect(result.attempts.map(attempt=>attempt.status)).toEqual(['deferred','succeeded','succeeded']);
 expect(vi.getTimerCount()).toBe(0);
});

it('continues charging a started read failure after an unstarted admission is refunded',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(Response.json({category:'reader_busy'},{status:429,headers:{'Retry-After':'3'}}))
  .mockImplementation(async()=>Response.json({category:'reader_timeout'},{status:502}));
 const pending=createCompanyMissingFieldResearch({readPage:createMissingFieldCrawlReader({LOCAL_DEVELOPMENT:'true'},fetcher)})({...input,deadline:10000});
 await vi.advanceTimersByTimeAsync(3000);
 const result=await pending;
 expect(fetcher).toHaveBeenCalledTimes(2);
 expect(result.fields.company_emails?.status).toBe('research_incomplete');
 expect(result.attempts).toContainEqual(expect.objectContaining({status:'failed',category:'reader_timeout'}));
 expect(vi.getTimerCount()).toBe(0);
});
