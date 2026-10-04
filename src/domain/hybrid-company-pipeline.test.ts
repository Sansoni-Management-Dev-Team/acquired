import {it,expect,vi} from 'vitest';
import {runHybridCompanyPipeline} from './hybrid-company-pipeline';
const web=(domain:string)=>({domain,name:domain,website:`https://${domain}`,discovery:{url:`https://${domain}`,title:domain,snippet:'cleaning'}});
const firm=(domain:string,id:string)=>({id,name:domain,website:`https://${domain}`});
const checkpoint=async<T>(_n:string,fn:()=>Promise<T>)=>fn();
it('starts both discovery branches together and enriches before web discovery finishes',async()=>{
 const events:string[]=[];let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});
 const result=await runHybridCompanyPipeline({checkpoint,now:()=>0,control:async()=>true,plan:async()=>[{query:'one',page:1},{query:'two',page:1}],firmableSearch:async()=>{events.push('firmable');return {records:[firm('firm.example','f1')],totalCompany:1};},webSearch:async(_q,index)=>{events.push(`web-${index}`);if(index===1)await gate;return {ok:true,rows:[web(`web${index}.example`)]};},profile:async()=>{events.push('profile');release();return {ok:true,matched:true};},finish:vi.fn()},{deadline:100,maxCompanies:4,concurrency:2});
 expect(events.indexOf('firmable')).toBeLessThan(events.indexOf('profile'));expect(events.indexOf('web-0')).toBeLessThan(events.indexOf('profile'));expect(result.saved).toBe(3);expect(result.unprocessed).toBe(0);
});
it('merges domains across branches and retrieves each selected company once',async()=>{
 const profile=vi.fn(async()=>({ok:true,matched:true}));const result=await runHybridCompanyPipeline({checkpoint,now:()=>0,control:async()=>true,plan:async()=>[{query:'one',page:1}],firmableSearch:async()=>({records:[firm('shared.example','f1'),firm('firm.example','f2')],totalCompany:2}),webSearch:async()=>({ok:true,rows:[web('shared.example'),web('web.example')]}),profile,finish:vi.fn()},{deadline:100,maxCompanies:4,concurrency:2});
 expect(profile).toHaveBeenCalledTimes(3);expect(result.overlap).toBe(1);expect(result.selection.filter(r=>r.domain==='shared.example')[0].sources).toEqual(['firmable','web']);
});
it('reserves equal capacity for both branches even if Firmable returns first',async()=>{
 const result=await runHybridCompanyPipeline({checkpoint,now:()=>0,control:async()=>true,plan:async()=>[{query:'one',page:1}],firmableSearch:async()=>({records:Array.from({length:6},(_,i)=>firm(`f${i}.example`,`f${i}`)),totalCompany:6}),webSearch:async()=>({ok:true,rows:Array.from({length:6},(_,i)=>web(`w${i}.example`))}),profile:async()=>({ok:true,matched:true}),finish:vi.fn()},{deadline:100,maxCompanies:4,concurrency:2});
 expect(result.selection.filter(r=>r.sources.includes('firmable'))).toHaveLength(2);expect(result.selection.filter(r=>r.sources.includes('web'))).toHaveLength(2);
});
it('records a discovery branch failure while retaining the other results',async()=>{
 const result=await runHybridCompanyPipeline({checkpoint,now:()=>0,control:async()=>true,plan:async()=>[{query:'one',page:1}],firmableSearch:async()=>{throw Error('upstream');},webSearch:async()=>({ok:true,rows:[web('web.example')]}),profile:async()=>({ok:true,matched:false}),finish:vi.fn()},{deadline:100,maxCompanies:4,concurrency:2});expect(result.discoveryFailed).toBe(1);expect(result.saved).toBe(1);
});
