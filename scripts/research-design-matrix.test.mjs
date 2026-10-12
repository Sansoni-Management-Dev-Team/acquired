import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { demoCases, matrixPlan } from './research-design-matrix.mjs';
import { benchmarkWorkloadSources, workloadFiles } from './research-design-workload.mjs';
import { createRequire } from 'node:module';

it('uses exact Run demo briefs and schedules every design once per contrasting mandate',async()=>{
 const cases=await demoCases();const plan=matrixPlan(cases);
 expect(cases.map(c=>c.slug)).toEqual(['packaging','veterinary','software']);
 expect(cases.every(c=>c.input.fromBrief&&c.mandate.filters.brief.naturalLanguage===c.mandate.natural_language)).toBe(true);
 expect(plan).toHaveLength(18);expect(new Set(plan.map(p=>`${p.case}:${p.design}`)).size).toBe(18);
 for(const c of cases)expect(plan.filter(p=>p.case===c.slug).map(p=>p.design).sort()).toEqual(['A','B','C','D','E','F']);
});

it('applies common limits to isolated source and refuses unexpected architecture changes',()=>{
 const files=workloadFiles;
 const original=Object.fromEntries(files.map(f=>[f,readFileSync(f,'utf8')]));
 const source=benchmarkWorkloadSources({...original},{companies:20,minutes:10});
 expect(source[files[0]].match(/maxCompanies:20/g)).toHaveLength(3);
 expect(source[files[1]]).toContain('DISCOVERY_CANDIDATE_LIMIT = 20');expect(source[files[1]]).toContain('automaticDeadline: Date.now() + 10 * 60 * 1000');
 expect(source[files[3]]).toContain('if (selectedDomains.size >= 20) return;');
 expect(source[files[4]]).toContain('discovery.targets.slice(0, 20)');
 for(const file of files)expect(readFileSync(file,'utf8')).toBe(original[file]);
 expect(()=>benchmarkWorkloadSources({...original,[files[0]]:''},{companies:20,minutes:10})).toThrow('no longer matches');
 expect(()=>benchmarkWorkloadSources({...original},{companies:0,minutes:10})).toThrow('Invalid');
});

it('keeps the same 20 admitted businesses across successive refill snapshots, including C company jobs',()=>{
 const sources=benchmarkWorkloadSources(Object.fromEntries(workloadFiles.map(f=>[f,readFileSync(f,'utf8')])),{companies:20,minutes:10});
 const text=sources['src/lib/parallel-business-research.ts'];
 const fn=text.slice(text.indexOf('export function parallelBusinessTasks('),text.indexOf('export async function dispatchParallelBusinessResearch'));
 const require=createRequire(import.meta.url);const esbuild=createRequire(require.resolve('vitest/package.json'))('esbuild');
 const code=esbuild.transformSync(fn.replace('export function','function'),{loader:'ts'}).code;
 const domain=url=>new URL(url).hostname.replace(/^www\./,'');
 const plan=new Function('publicResearchUrl','directorySource','unreadableDiscoverySource','serviceBusinessDomain','researchDomain','rankDiscoveryCandidateUrls','taskId','prioritiseResearchPages','researchUrlKey','DISCOVERY_CANDIDATE_LIMIT',code+';return parallelBusinessTasks;')(
  url=>url,()=>false,()=>false,()=>false,domain,urls=>urls,(root,key)=>root+':'+key,urls=>urls,url=>url,20,
 );
 const root={id:'root',seeds:Array.from({length:60},(_,i)=>`https://business${i}.example.com/`),config:{findPeople:true,newBusinessIds:[],targetBusinesses:20}};
 const first=plan({root,jobs:[root],members:[],findings:[]});
 const firstDomains=new Set(first.map(t=>t.config.companyDomain));expect(firstDomains.size).toBe(20);
 const admitted=first.filter(t=>t.config.researchTask==='website').map(t=>({...t,config:{...t.config,researchTask:'company',researchRunId:'root'},seeds:[]}));
 root.seeds=[...root.seeds.slice(20),...root.seeds.slice(0,20)];
 const second=plan({root,jobs:[root,...admitted],members:[],findings:[]});
 expect(new Set(second.map(t=>t.config.companyDomain))).toEqual(firstDomains);
 expect(new Set([...first,...second].map(t=>t.config.companyDomain)).size).toBe(20);
});
