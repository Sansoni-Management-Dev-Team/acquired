import { comparisonFingerprint } from './benchmark-research-pipeline.mjs';
const terminal=new Set(['complete','partial','failed','cancelled']);
export function localBenchmarkDatabase(name){
 if(!/^project_acquire_bench_[a-z0-9_]{1,48}$/.test(name))throw Error('Only disposable benchmark database names are allowed');
 return `postgresql://project_acquire:project_acquire@127.0.0.1:5434/${name}`;
}
export function designSnapshot({jobs,findings,fieldSatisfied,fields=['abn','size','revenue','people','email'],now=Date.now()}){
 const root=jobs.find(j=>j.config.researchRunId===j.id&&!j.config.researchTask)||jobs[0];
 if(!root)throw Error('Benchmark root missing');
 const groups={},domains=new Map(),ids=new Set(jobs.map(j=>j.id));
 for(const j of jobs){const field=j.config.researchField||j.config.researchTask||'discovery';const g=groups[field]||={jobs:0,complete:0,partial:0,active:0,pages:0,modelCalls:0,firstStartMs:new Date(j.created_at)-new Date(root.created_at)};g.jobs++;g.complete+=Number(j.status==='complete');g.partial+=Number(j.status==='partial');g.active+=Number(!terminal.has(j.status));g.pages+=j.pages;g.modelCalls+=j.model_calls;if(j.config.companyDomain){const set=domains.get(j.config.companyDomain)||new Set();if(j.config.targetId)set.add(j.config.targetId);domains.set(j.config.companyDomain,set);}}
 // Company corpus jobs acquire target links when their findings are saved.
 const jobDomains=new Map(jobs.filter(j=>j.config.companyDomain).map(j=>[j.id,j.config.companyDomain]));
 for(const f of findings){const domain=jobDomains.get(f.job_id);if(domain&&f.target_id&&ids.has(f.job_id))domains.get(domain)?.add(f.target_id);}
 const active=jobs.filter(j=>!terminal.has(j.status)).length;
 const settled=root.config.parallelResearchSettled===true;
 const deadlineReached=now>=root.config.automaticDeadline;
 const finished=active===0&&(settled||deadlineReached);
 const latest=Math.max(...jobs.map(j=>new Date(j.updated_at).getTime()));
 const relevant=new Set(jobs.flatMap(j=>j.config.newBusinessIds||[]));
 const firmable=['firmable-v1','web-firmable-v1','hybrid-firmable-v1'].includes(root.config.pipelineDesign);
 const profiles=jobs.filter(j=>j.config.firmableProfile).map(j=>j.config.firmableProfile);
 const bandCoverage=firmable?Object.fromEntries([['headcountBand','headcountBand'],['revenueBand','revenueBand']].map(([name,key])=>{const found=profiles.filter(p=>p[key]).length;return[name,{found,total:domains.size,percent:domains.size?Math.round(found/domains.size*1000)/10:0}]})):undefined;

 const screening=firmable?{excluded:jobs.filter(j=>Object.values(j.config.screening||{}).includes('excluded')).length,review:jobs.filter(j=>j.config.screening&&!Object.values(j.config.screening).includes('excluded')).length}:undefined;
 return {screening,bandCoverage,capabilities:firmable?{people:'not_requested',email:'not_requested',headcountExact:profiles.filter(p=>p.headcountExact!==null).length}:undefined,observedAt:new Date(now).toISOString(),rootId:root.id,status:root.status,settled,deadlineReached,finished,completion:finished?(settled?'settled':'deadline'):null,elapsedMs:(finished?latest:now)-new Date(root.created_at),jobs:jobs.length,active,researchedCompanies:domains.size,qualifiedCompanies:relevant.size,pages:jobs.reduce((n,j)=>n+j.pages,0),modelCalls:jobs.reduce((n,j)=>n+j.model_calls,0),groups,coverage:Object.fromEntries(fields.map(field=>{const found=[...domains.entries()].filter(([domain,targets])=>fieldSatisfied(field,findings.filter(f=>ids.has(f.job_id)&&(jobDomains.get(f.job_id)===domain||targets.has(f.target_id))).map(f=>f.evidence))).length;return[field,{found,total:domains.size,percent:domains.size?Math.round(found/domains.size*1000)/10:0}];}))};
}
export function compareDesigns(a,b){
 const reasons=[];
 for(const key of ['caseHash','baselineHash','providerHash','observerHash'])if(a.manifest[key]!==b.manifest[key])reasons.push(`${key} differs`);
 if(!a.summary.finished||!b.summary.finished)reasons.push('Both runs must finish');
 return {comparable:!reasons.length,reasons,a:a.summary,b:b.summary,durationRatio:!reasons.length?b.summary.elapsedMs/a.summary.elapsedMs:null,note:'Live runs remain subject to website/model drift; at least three alternating repetitions per design are needed before claiming a performance improvement.'};
}
export const benchmarkHash=comparisonFingerprint;
/** Observed events only. Nested failed requests are events, not unique incidents. */
export function observedDesignMetrics(log,jobIds){
 const ids=new Set(jobIds),requests=new Map(),spans=new Map(),queries=new Map();const cache={},deferrals={};let reportedCost=0;
 for(const line of log.split('\n')){const i=line.indexOf('{');if(i<0)continue;let e;try{e=JSON.parse(line.slice(i));}catch{continue;}if(!ids.has(e.jobId)&&!ids.has(e.runId))continue;
  if(e.event==='segment_finished'&&e.id&&Number.isFinite(e.elapsedMs))spans.set(e.id,e);
  if(e.event==='query_finished'&&e.queryId)queries.set(e.queryId,e);
  if(e.requestId&&['request_started','request_completed','request_failed'].includes(e.event)){const key=[e.provider,e.operation,e.requestId].join(':');requests.set(key,{...(requests.get(key)||{}),...e});}
  if(e.event==='reader_deferred'||(e.event==='permit_result'&&e.granted===false)){const key=e.category||'admission_wait';deferrals[key]=(deferrals[key]||0)+1;}
  if(line.startsWith('research-cache ')){const key=`${e.kind}:${e.event}`;cache[key]=(cache[key]||0)+1;}
  if(line.startsWith('research-ai ')&&typeof e.cost==='number')reportedCost+=e.cost;
 }
 const stages={};for(const e of spans.values()){const a=stages[e.segment]||=[];a.push(e.elapsedMs);}for(const [name,a]of Object.entries(stages)){a.sort((x,y)=>x-y);stages[name]={count:a.length,meanMs:Math.round(a.reduce((n,v)=>n+v,0)/a.length),p95Ms:a[Math.ceil(a.length*.95)-1],maxMs:a.at(-1)};}
 const failures={};for(const r of requests.values())if(r.event==='request_failed'){const key=[r.provider,r.operation,r.httpStatus||r.category||'transport'].join(':');failures[key]=(failures[key]||0)+1;}
 return{requestEvents:requests.size,failedRequestEvents:failures,deferrals,cache,databaseQueryAttempts:queries.size,databaseRoundTripMs:[...queries.values()].reduce((n,q)=>n+(q.elapsedMs||0),0),reportedModelCostUsd:reportedCost,stages};
}
