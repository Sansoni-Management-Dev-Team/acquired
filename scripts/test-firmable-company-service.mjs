// Small company-only validation using the existing session coordinator; no people/export calls.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
const require=createRequire(import.meta.url),esbuild=createRequire(require.resolve('vitest/package.json'))('esbuild');
const out=resolve('.local-data/firmable-D-preflight');mkdirSync(out,{recursive:true,mode:0o700});
esbuild.buildSync({entryPoints:['cloudflare/research/firmable/account.ts'],bundle:true,platform:'node',format:'esm',outfile:resolve(out,'account.mjs')});
const {FirmableAccount}=await import(resolve(out,'account.mjs'));const env=JSON.parse(readFileSync('.local-data/firmable-D-credentials.json'));
const state=new Map();const observedFetch=async(url,init)=>{const r=await fetch(url,init);const payload=await r.clone().json().catch(()=>null);console.log(JSON.stringify({upstream:new URL(url).hostname,status:r.status,errorCodes:payload?.errors?.map(e=>e.code)}));return r;};const account=new FirmableAccount({get:async k=>state.get(k),put:async(k,v)=>state.set(k,structuredClone(v))},env,observedFetch);
const testCase=JSON.parse(readFileSync('.local-data/research-design/baseline-C-v9/case.json'));
const started=Date.now(),report={startedAt:new Date().toISOString(),calls:[]};
async function call(input){const start=Date.now(),r=await account.handle(input);report.calls.push({path:input.path,status:r.status,elapsedMs:Date.now()-start,...(r.status!==200?{category:r.body.category}:{})});writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2),{mode:0o600});if(r.status!==200)throw Error(`Firmable ${input.path} failed: ${r.status} ${r.body.category}`);return r.body;}
const page=await call({path:'/company/search',method:'POST',query:{},body:{query:testCase.mandate.natural_language,size:100}});writeFileSync(resolve(out,'search.json'),JSON.stringify(page,null,2),{mode:0o600});
for(const row of page.records.slice(0,5)){const profile=await call({path:'/company',method:'GET',query:{id:row.id}});writeFileSync(resolve(out,`${row.id}.json`),JSON.stringify(profile,null,2),{mode:0o600});}
if(page.totalCompany>100){const next=await call({path:'/company/search',method:'POST',query:{},body:{from:100,size:100,interpreted:page.predictedFilters}});report.pagination={first:page.records.length,second:next.records.length,overlap:next.records.filter(r=>page.records.some(x=>x.id===r.id)).length};}
report.totalCompany=page.totalCompany;report.elapsedMs=Date.now()-started;writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report));
