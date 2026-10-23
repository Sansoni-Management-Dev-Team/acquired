import {buildAllDiscoveredCompanyPeoplePolicy,buildAllDiscoveredCompanyPolicy,reviewedCompanyDiscoveryPolicy} from './research-discovery-policy';
import type {CompanyDiscoveryPolicy} from './research-discovery-policy';
import type {WebQuery} from './web-firmable-pipeline';
import type {HybridCompanyContinuation} from './hybrid-company-continuation';
import {it,expect,vi} from 'vitest';
import {runHybridCompanyPipeline,hybridCompanyPartialResult,type HybridCompany} from './hybrid-company-pipeline';
const web=(domain:string)=>({domain,name:domain,website:`https://${domain}`,discovery:{url:`https://${domain}`,title:domain,snippet:'cleaning'}});
const firm=(domain:string,id:string)=>({id,name:domain,website:`https://${domain}`});
const checkpoint=async<T>(_n:string,fn:()=>Promise<T>)=>fn();
it.each([2,3])('balances labelled AU staff bands only for newly reviewed v3, preserving v%s selection',async(version)=>{
 const rows=Array.from({length:175},(_,i)=>({...firm(`band${i}.example`,`f${i}`),au_employee_count:i<72?3:2}));
 const policy={...reviewedCompanyDiscoveryPolicy,...(version===3?{version:3,profileSelection:{strategy:'labelled_au_staff_bands',requestedHeadcount:{min:30,max:80},unknownBands:'retain_after_labelled',qualification:'profile_required'}}:{})} as CompanyDiscoveryPolicy;
 const selected:Record<string,unknown>[]=[],search=vi.fn(async(from=0)=>({records:rows.slice(from,from+100),totalCompany:175,predictedFilters:{filters:{company_size:{'2':'11 - 50','3':'51 - 250'}},operators:{},excluded:{}},predictedCountry:{include:['AU'],operator:'OR'}}));
 const result=await runHybridCompanyPipeline({checkpoint,now:()=>0,control:async()=>true,plan:async()=>[],firmableSearch:search,webSearch:async()=>({rows:[],ok:true}),profile:async c=>{selected.push(c.firmableRow!);return{ok:true}},finish:vi.fn()},{deadline:1,maxCompanies:20,concurrency:2,discoveryPolicy:policy});
 expect(search).toHaveBeenCalledTimes(2);expect(selected).toHaveLength(20);expect(selected.every(r=>!Object.hasOwn(r,'employee_count'))).toBe(true);
 expect(selected.filter(r=>r.au_employee_count===2)).toHaveLength(version===3?10:0);
 expect(selected.filter(r=>r.au_employee_count===3)).toHaveLength(version===3?10:20);
 expect(rows[0].au_employee_count).toBe(3);expect(result.firmableSampledRows).toBe(175);
});
it.each([undefined,reviewedCompanyDiscoveryPolicy])('drains in-flight discovery and profiles before reporting the original fatal profile error, policy %j',async(discoveryPolicy)=>{
 let releaseWeb!:()=>void,releaseProfile!:()=>void,bothStarted!:()=>void,fatalStarted!:()=>void;
 const webGate=new Promise<void>(r=>{releaseWeb=r;}),profileGate=new Promise<void>(r=>{releaseProfile=r;}),twoProfiles=new Promise<void>(r=>{bothStarted=r;}),fatal=new Promise<void>(r=>{fatalStarted=r;});
 const original=Error('Firmable 429'),events:string[]=[],finish=vi.fn(),beforeFinish=vi.fn();let settled=false;
 const search=vi.fn(async()=>{await webGate;events.push('web persisted');return{rows:[web('late.example')],ok:true};});
 const profile=vi.fn(async(company:{domain:string})=>{events.push('profile '+company.domain);if(events.filter(e=>e.startsWith('profile ')).length===2)bothStarted();await twoProfiles;if(company.domain==='one.example'){fatalStarted();throw original;}await profileGate;events.push('profile persisted');return{ok:true};});
 const outcome=runHybridCompanyPipeline({checkpoint,now:()=>0,control:async()=>true,plan:async()=>[{query:'first',page:1},{query:'must not start',page:1}],firmableSearch:async()=>({records:['one','two','queued'].map((n,i)=>firm(n+'.example','f'+i)),totalCompany:3}),webSearch:search,profile,finish,beforeFinish},{deadline:100,maxCompanies:discoveryPolicy?20:6,concurrency:2,discoveryPolicy}).then(()=>{settled=true;return null;},error=>{settled=true;return error;});
 await fatal;for(let i=0;i<8;i++)await Promise.resolve();
 expect(settled).toBe(false);expect(profile).toHaveBeenCalledTimes(2);expect(search).toHaveBeenCalledOnce();
 releaseWeb();for(let i=0;i<8;i++)await Promise.resolve();expect(settled).toBe(false);expect(search).toHaveBeenCalledOnce();
 releaseProfile();expect(await outcome).toBe(original);expect(hybridCompanyPartialResult(original)).toBeUndefined();expect(events).toContain('web persisted');expect(events).toContain('profile persisted');expect(profile).toHaveBeenCalledTimes(2);expect(beforeFinish).not.toHaveBeenCalled();expect(finish).not.toHaveBeenCalled();
});
it('waits for contacts outside completion checkpoints even when waiting exceeds two minutes',async()=>{
 let activeStep:string|undefined,elapsed=0;const events:string[]=[];
 const checkpoint=async<T>(name:string,fn:()=>Promise<T>)=>{
  if(activeStep)throw Error(`Nested workflow step inside ${activeStep}`);
  activeStep=name;const start=elapsed;
  try{const result=await fn();if(elapsed-start>=120000)throw Error('Execution timed out after 120000ms');return result;}finally{activeStep=undefined;}
 };
 await runHybridCompanyPipeline({checkpoint,now:()=>elapsed,control:async()=>true,plan:async()=>[],firmableSearch:async()=>({records:[],totalCompany:0}),webSearch:async()=>({rows:[],ok:true}),profile:async()=>({ok:true}),beforeFinish:async()=>{
  expect(activeStep).toBeUndefined();
  for(let i=0;i<15;i++){await checkpoint(`contacts-${i}`,async()=>{events.push('poll');});elapsed+=10000;}
 },finish:async()=>{expect(activeStep).toBe('f-finish');events.push('finish');}},{deadline:600000,maxCompanies:100,concurrency:2});
 expect(elapsed).toBe(150000);expect(events).toHaveLength(16);expect(events.at(-1)).toBe('finish');
});
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
it('samples two bounded provider pages using original filters while profiling only twenty distinct companies',async()=>{
 const filters={filters:{company_size:{'2':'11 - 50'},country:{AU:'Australia'}},operators:{company_size:'OR',country:'OR'},excluded:{country:{NZ:'New Zealand'}}};
 const search=vi.fn(async(from=0)=>({records:Array.from({length:100},(_,i)=>firm(`${from+i}.example`,`f${from+i}`)),totalCompany:171,predictedFilters:filters}));const profile=vi.fn(async(company:HybridCompany)=>{void company;return{ok:true,matched:true};});
 const r=await runHybridCompanyPipeline({checkpoint,now:()=>0,control:async()=>true,plan:async()=>[],firmableSearch:search,webSearch:async()=>({rows:[],ok:true}),profile,finish:vi.fn()},{deadline:100,maxCompanies:20,concurrency:2,discoveryPolicy:reviewedCompanyDiscoveryPolicy});
 expect(search.mock.calls).toEqual([[0,undefined],[100,filters]]);expect(profile).toHaveBeenCalledTimes(20);expect(r.firmableDiscovered).toBe(200);
});
it('covers all reviewed web query slices before filling the profile cap from the first subsection',async()=>{
 const search=vi.fn(async(q:{query:string})=>({rows:Array.from({length:20},(_,i)=>web(q.query+i+'.example')),ok:true}));
 const r=await runHybridCompanyPipeline({checkpoint,now:()=>0,control:async()=>true,plan:async()=>['laundry','cleaning','waste','facilities','laundry2','cleaning2','unreviewed7'].map(query=>({query,page:1})),firmableSearch:async()=>({records:[],totalCompany:0}),webSearch:search,profile:async()=>({ok:true}),finish:vi.fn()},{deadline:100,maxCompanies:20,concurrency:2,discoveryPolicy:reviewedCompanyDiscoveryPolicy});
 expect(search).toHaveBeenCalledTimes(6);for(const name of ['laundry','cleaning','waste','facilities'])expect(r.selection.some(c=>c.domain.startsWith(name))).toBe(true);expect(r.saved).toBe(20);
});
it('deprioritises clearly labelled public bodies after sampling without interpreting band codes as employee counts',async()=>{
 const rows=Array.from({length:100},(_,i)=>({...firm(i<20?`council${i}.example`:`operator${i}.example`,`f${i}`),name:i<20?`Shire Council ${i}`:`Service operator ${i}`,au_employee_count:i<20?2:3}));const profile=vi.fn(async()=>({ok:true}));
 const r=await runHybridCompanyPipeline({checkpoint,now:()=>0,control:async()=>true,plan:async()=>[],firmableSearch:async()=>({records:rows,totalCompany:100}),webSearch:async()=>({rows:[],ok:true}),profile,finish:vi.fn()},{deadline:100,maxCompanies:20,concurrency:2,discoveryPolicy:reviewedCompanyDiscoveryPolicy});
 expect(r.selection.every(c=>c.domain.startsWith('operator'))).toBe(true);expect(profile).toHaveBeenCalledTimes(20);expect(r.firmableDiscovered).toBe(100);
});
it('preserves the first sample if a later page fails and reports the partial discovery honestly',async()=>{
 const search=vi.fn().mockResolvedValueOnce({records:Array.from({length:100},(_,i)=>firm(`${i}.example`,`f${i}`)),totalCompany:171,predictedFilters:{filters:{},operators:{},excluded:{}},predictedCountry:{include:['AU'],operator:'OR'}}).mockRejectedValueOnce(Error('Original second page outcome unknown'));
 const r=await runHybridCompanyPipeline({checkpoint,now:()=>0,control:async()=>true,plan:async()=>[],firmableSearch:search,webSearch:async()=>({rows:[],ok:true}),profile:async()=>({ok:true}),finish:vi.fn()},{deadline:100,maxCompanies:20,concurrency:2,discoveryPolicy:reviewedCompanyDiscoveryPolicy});
 expect(r.saved).toBe(20);expect(r.discoveryFailed).toBe(1);expect(search).toHaveBeenCalledTimes(2);
});
it('never invents pagination filters or retries an unavailable sample and honours cancellation before profiling',async()=>{
 const search=vi.fn(async()=>({records:Array.from({length:100},(_,i)=>firm(`${i}.example`,`f${i}`)),totalCompany:200})),profile=vi.fn(async()=>({ok:true}));let active=true;
 const r=await runHybridCompanyPipeline({checkpoint,now:()=>0,control:async()=>active,plan:async()=>[],firmableSearch:async()=>{const result=await search();active=false;return result;},webSearch:async()=>({rows:[],ok:true}),profile,finish:vi.fn()},{deadline:100,maxCompanies:20,concurrency:2,discoveryPolicy:reviewedCompanyDiscoveryPolicy});
 expect(search).toHaveBeenCalledOnce();expect(profile).not.toHaveBeenCalled();expect(r.stopReason).toBe('cancelled');expect(r.discoveryFailed).toBe(1);
});
it('does not reinterpret old handles as expanded sampling when no new policy was reviewed',async()=>{const search=vi.fn(async()=>({records:[firm('legacy.example','f1')],totalCompany:200}));await runHybridCompanyPipeline({checkpoint,now:()=>0,control:async()=>true,plan:async()=>[],firmableSearch:search,webSearch:async()=>({rows:[],ok:true}),profile:async()=>({ok:true}),finish:vi.fn()},{deadline:100,maxCompanies:100,concurrency:2});expect(search.mock.calls).toEqual([[]]);});
it('retains earlier web discovery when a later query outcome is unavailable, without retrying it',async()=>{const search=vi.fn().mockResolvedValueOnce({rows:[web('saved.example')],ok:true}).mockRejectedValueOnce(Error('Unknown original query outcome'));const r=await runHybridCompanyPipeline({checkpoint,now:()=>0,control:async()=>true,plan:async()=>[{query:'first',page:1},{query:'second',page:1}],firmableSearch:async()=>({records:[],totalCompany:0}),webSearch:search,profile:async()=>({ok:true}),finish:vi.fn()},{deadline:100,maxCompanies:20,concurrency:2,discoveryPolicy:reviewedCompanyDiscoveryPolicy});expect(r.saved).toBe(1);expect(r.discoveryFailed).toBe(1);expect(search).toHaveBeenCalledTimes(2);});
it('binds the provider separate explicit AU prediction into the next page filters instead of losing country',async()=>{const filters={filters:{company_size:{'2':'11 - 50'}},operators:{company_size:'OR'},excluded:{industry:{government:'Government'}}};const search=vi.fn(async(from=0)=>({records:from?[]:Array.from({length:100},(_,i)=>firm(`${i}.example`,`f${i}`)),totalCompany:101,predictedFilters:filters,predictedCountry:{include:['AU'],operator:'OR'}}));await runHybridCompanyPipeline({checkpoint,now:()=>0,control:async()=>true,plan:async()=>[],firmableSearch:search,webSearch:async()=>({rows:[],ok:true}),profile:async()=>({ok:true}),finish:vi.fn()},{deadline:100,maxCompanies:20,concurrency:2,discoveryPolicy:reviewedCompanyDiscoveryPolicy});expect(search.mock.calls[1]).toEqual([100,{filters:{...filters.filters,country:{AU:'Australia'}},operators:{...filters.operators,country:'OR'},excluded:filters.excluded}]);expect(filters.filters).not.toHaveProperty('country');});
it.each([undefined,{include:['AU','NZ'],operator:'OR'},{include:['NZ'],operator:'OR'},{include:['AU'],operator:'AND'}])('stops before another sample page when country interpretation is unknown or incompatible %j',async(predictedCountry)=>{const search=vi.fn(async()=>({records:Array.from({length:100},(_,i)=>firm(`${i}.example`,`f${i}`)),totalCompany:101,predictedFilters:{filters:{},operators:{},excluded:{}},predictedCountry}));const r=await runHybridCompanyPipeline({checkpoint,now:()=>0,control:async()=>true,plan:async()=>[],firmableSearch:search,webSearch:async()=>({rows:[],ok:true}),profile:async()=>({ok:true}),finish:vi.fn()},{deadline:100,maxCompanies:20,concurrency:2,discoveryPolicy:reviewedCompanyDiscoveryPolicy});expect(search).toHaveBeenCalledOnce();expect(r.saved).toBe(20);expect(r.discoveryFailed).toBe(1);});

it('v4 profiles every unique discovered identity without source quotas, retaining missing websites and conflicting IDs',async()=>{
 const rows=[...Array.from({length:30},(_,i)=>firm(`all${i}.example`,`f${i}`)),{id:'f900',name:'No website'},firm('all0.example','f901'),firm('all1.example','f1')];
 const profile=vi.fn(async(company:HybridCompany)=>{void company;return{ok:true,matched:true};});
 const r=await runHybridCompanyPipeline({checkpoint,now:()=>0,control:async()=>true,plan:async()=>[{query:'first',page:1}],firmableSearch:async()=>({records:rows,totalCompany:rows.length}),webSearch:async()=>({ok:true,rows:[web('all2.example'),web('extra.example'),web('all0.example')]}),profile,finish:vi.fn()},{deadline:100,maxCompanies:800,concurrency:2,discoveryPolicy:buildAllDiscoveredCompanyPolicy()});
 expect(profile).toHaveBeenCalledTimes(33);expect(r.saved).toBe(33);expect(r.unprocessed).toBe(0);expect(r.stopReason).toBe('exhausted');
 expect(profile.mock.calls.some(([c])=>c.firmableRow?.id==='f900')).toBe(true);expect(profile.mock.calls.filter(([c])=>c.domain==='all0.example')).toHaveLength(2);
 expect(r.selection.find(c=>c.firmableId==='f2')?.sources).toEqual(['firmable','web']);expect(r.selection.find(c=>c.firmableId==='f900')?.candidateKey).toBe('firmable:f900');
});
it('v4 reports discovery coverage and preserves queued candidates when its deadline expires',async()=>{
 let now=0;const r=await runHybridCompanyPipeline({checkpoint,now:()=>now,control:async()=>true,plan:async()=>[],firmableSearch:async()=>({records:Array.from({length:100},(_,i)=>firm(`all${i}.example`,`f${i}`)),totalCompany:500,predictedFilters:{filters:{},operators:{},excluded:{}},predictedCountry:{include:['AU'],operator:'OR'}}),webSearch:async()=>({rows:[],ok:true}),profile:async()=>{now=100;return{ok:true}},finish:vi.fn()},{deadline:100,maxCompanies:800,concurrency:1,discoveryPolicy:buildAllDiscoveredCompanyPolicy()});
 expect(r.candidates).toBe(100);expect(r.unprocessed).toBe(99);expect(r.stopReason).toBe('deadline');expect(r.discoveryCoverage).toMatchObject({firmableReportedTotal:500,firmableTruncated:true});expect(r.selection[0]).toMatchObject({outcome:'saved'});expect(r.selection.slice(1).every(c=>c.outcome==='not_started')).toBe(true);
});
it.each([['native_budget_admission_required','web_budget_limited'],['native_provider_reconciliation_required','web_reconciliation_required']])('v4 stops supplemental discovery on %s while draining original Firmable candidates',async(category,stopReason)=>{
 const webSearch=vi.fn(async(_query:WebQuery,index:number)=>index===2?{rows:[],ok:false,category}:{rows:[],ok:true});const finish=vi.fn();
 const r=await runHybridCompanyPipeline({checkpoint,now:()=>0,control:async()=>true,plan:async()=>Array.from({length:6},(_,i)=>({query:`query ${i}`,page:1})),firmableSearch:async()=>({records:[firm('retained.example','f1')],totalCompany:1}),webSearch,profile:async()=>({ok:true,saved:true}),finish},{deadline:100,maxCompanies:800,concurrency:1,discoveryPolicy:buildAllDiscoveredCompanyPolicy()});
 expect(webSearch.mock.calls.map(([,index])=>index)).toEqual([0,1,2]);expect(r).toMatchObject({saved:1,unprocessed:0,searches:3,searchFailed:1,stopReason,discoveryCoverage:{webQueries:{planned:6,attempted:3,unattempted:3,stopCategory:category}}});expect(r.selection[0]).toMatchObject({outcome:'saved'});expect(finish).toHaveBeenCalledWith(r);
});
it('profiles only fresh reviewed continuation candidates through the existing queue without rediscovery',async()=>{
 const continuation:HybridCompanyContinuation={version:1,sourceRootId:'00000000-0000-4000-8000-000000000001',sourceDigest:'a'.repeat(64),candidates:[{candidateKey:'firmable:f2',domain:'',sources:['firmable'],firmableRow:{id:'f2',name:'Original missing-website source'}},{candidateKey:'domain:web.example',domain:'web.example',sources:['web'],webRow:web('web.example')}]};
 const plan=vi.fn(async()=>{throw Error('Continuation must not plan discovery');}),firmableSearch=vi.fn(async()=>{throw Error('Continuation must not rerun Firmable discovery');}),webSearch=vi.fn(async()=>{throw Error('Continuation must not rerun web discovery');}),profile=vi.fn(async(company:HybridCompany)=>{void company;return{ok:true,saved:true};}),finish=vi.fn(),steps:string[]=[];
 const r=await runHybridCompanyPipeline({checkpoint:async<T>(name:string,fn:()=>Promise<T>)=>{steps.push(name);return fn();},now:()=>0,control:async()=>true,plan,firmableSearch,webSearch,profile,finish},{deadline:100,maxCompanies:800,concurrency:1,discoveryPolicy:buildAllDiscoveredCompanyPolicy(),continuation,traceContext:{jobId:'00000000-0000-4000-8000-000000000002'}});
 expect(plan).not.toHaveBeenCalled();expect(firmableSearch).not.toHaveBeenCalled();expect(webSearch).not.toHaveBeenCalled();expect(profile.mock.calls.map(([company])=>(company as HybridCompany).candidateKey)).toEqual(['firmable:f2','domain:web.example']);expect(steps).toEqual(['f-company-firmable:f2','f-company-domain:web.example','f-finish']);expect(r).toMatchObject({saved:2,unprocessed:0,searches:0,continuation:{version:1,sourceRootId:continuation.sourceRootId,sourceDigest:continuation.sourceDigest},discoveryCoverage:{scope:'reviewed_saved_candidates',webQueries:{planned:0,attempted:0,unattempted:0}}});expect(r.selection.every(c=>c.outcome==='saved')).toBe(true);
});
it('retains every unstarted continuation candidate when fresh execution is cancelled before profiling',async()=>{
 const continuation:HybridCompanyContinuation={version:1,sourceRootId:'00000000-0000-4000-8000-000000000001',sourceDigest:'a'.repeat(64),candidates:[{candidateKey:'firmable:f2',domain:'',sources:['firmable'],firmableRow:{id:'f2',name:'Original source'}}]};const profile=vi.fn();
 const r=await runHybridCompanyPipeline({checkpoint,now:()=>0,control:async()=>false,plan:async()=>{throw Error('No new discovery');},firmableSearch:async()=>{throw Error('No new discovery');},webSearch:async()=>{throw Error('No new discovery');},profile,finish:vi.fn()},{deadline:100,maxCompanies:800,concurrency:1,discoveryPolicy:buildAllDiscoveredCompanyPolicy(),continuation});expect(profile).not.toHaveBeenCalled();expect(r).toMatchObject({unprocessed:1,stopReason:'cancelled',selection:[{candidateKey:'firmable:f2',outcome:'not_started'}]});
});
it.each(['legacy_policy','original_root'])('rejects continuation under %s before any discovery/profile work',async reason=>{
 const sourceRootId='00000000-0000-4000-8000-000000000001',continuation:HybridCompanyContinuation={version:1,sourceRootId,sourceDigest:'a'.repeat(64),candidates:[{candidateKey:'firmable:f2',domain:'',sources:['firmable'],firmableRow:{id:'f2',name:'Original source'}}]},plan=vi.fn(),profile=vi.fn();
 await expect(runHybridCompanyPipeline({checkpoint,now:()=>0,control:async()=>true,plan,firmableSearch:vi.fn(),webSearch:vi.fn(),profile,finish:vi.fn()},{deadline:100,maxCompanies:reason==='legacy_policy'?20:800,concurrency:1,discoveryPolicy:reason==='legacy_policy'?reviewedCompanyDiscoveryPolicy:buildAllDiscoveredCompanyPolicy(),continuation,...(reason==='original_root'?{traceContext:{jobId:sourceRootId}}:{})})).rejects.toThrow('fresh reviewed V4');expect(plan).not.toHaveBeenCalled();expect(profile).not.toHaveBeenCalled();
});
it('v4 retains completed and never-started evidence after an interrupted profile and drains late discovery without retrying it',async()=>{
 let releaseWeb!:()=>void,rejectedProfile!:()=>void;const webGate=new Promise<void>(r=>{releaseWeb=r;}),profileRejected=new Promise<void>(r=>{rejectedProfile=r;});
 const original=Error('Callback failed (409)'),profile=vi.fn(async(company:HybridCompany)=>{const id=company.firmableRow?.id;if(id==='f1')return{ok:true,saved:false,identityReviewRequired:true};if(id==='f2')return{ok:true,saved:false,skipped:true};if(id==='f3')return{ok:false,saved:false};if(id==='f4'){rejectedProfile();throw original;}return{ok:true,saved:true,matched:true};}),finish=vi.fn();
 const pending=runHybridCompanyPipeline({checkpoint,now:()=>0,control:async()=>true,plan:async()=>[{query:'in flight',page:1},{query:'must not start',page:1}],firmableSearch:async()=>({records:Array.from({length:7},(_,i)=>firm(`retained${i}.example`,`f${i}`)),totalCompany:7}),webSearch:async()=>{await webGate;return{rows:[web('late.example')],ok:true};},profile,finish},{deadline:100,maxCompanies:800,concurrency:1,discoveryPolicy:buildAllDiscoveredCompanyPolicy()}).catch(error=>error);
 await profileRejected;for(let i=0;i<8;i++)await Promise.resolve();releaseWeb();const error=await pending;
 expect(error).toBe(original);expect(profile).toHaveBeenCalledTimes(5);expect(finish).not.toHaveBeenCalled();
 const partial=hybridCompanyPartialResult(error)!;expect(partial).toMatchObject({candidates:8,saved:1,failed:1,identityReviewRequired:1,skipped:1,interrupted:1,unprocessed:3,stopReason:'interrupted'});
 expect((partial.selection as {candidateKey:string;outcome:string}[]).map((c:{candidateKey:string;outcome:string})=>[c.candidateKey,c.outcome])).toEqual([['firmable:f0','saved'],['firmable:f1','review'],['firmable:f2','skipped'],['firmable:f3','known_failed'],['firmable:f4','interrupted'],['firmable:f5','not_started'],['firmable:f6','not_started'],['domain:late.example','not_started']]);
});

it('V5 retains all provider identities including conflicting domains and missing websites before automatic People admission',async()=>{
 const profile=vi.fn(async()=>({ok:true,saved:true,matched:true}));
 const result=await runHybridCompanyPipeline({checkpoint,now:()=>0,control:async()=>true,plan:async()=>[{query:'company scope',page:1}],firmableSearch:async()=>({records:[{id:'f1',name:'First company',website:'https://same.example'},{id:'f2',name:'Different company',website:'https://same.example'},{id:'f3',name:'Company without website'}],totalCompany:3}),webSearch:async()=>({ok:true,rows:[web('same.example'),web('extra.example')]}),profile,finish:vi.fn()},{deadline:100,maxCompanies:800,concurrency:2,discoveryPolicy:buildAllDiscoveredCompanyPeoplePolicy()});
 expect(result).toMatchObject({candidates:4,saved:4,firmableDiscovered:3});expect(profile).toHaveBeenCalledTimes(4);expect(result.selection.map(x=>x.candidateKey)).toEqual(expect.arrayContaining(['firmable:f1','firmable:f2','firmable:f3','domain:extra.example']));
});
