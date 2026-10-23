import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { demoCases, matrixPlan } from './research-design-matrix.mjs';
import { benchmarkWorkloadSources, workloadFiles } from './research-design-workload.mjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const workloadSource = () => Object.fromEntries(workloadFiles.map(file => [file, readFileSync(file, 'utf8')]));
function propertyExpressions(source, name) {
 const parsed = ts.createSourceFile('benchmark.ts', source, ts.ScriptTarget.Latest, true);
 const expressions = [];
 function visit(node) {
  if (ts.isPropertyAssignment(node) && node.name.getText(parsed) === name) expressions.push(node.initializer.getText(parsed));
  ts.forEachChild(node, visit);
 }
 visit(parsed);
 return expressions;
}
function deadlineExpression(source) {
 const parsed = ts.createSourceFile('benchmark.ts', source, ts.ScriptTarget.Latest, true);
 const expressions = [];
 function visit(node) {
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && node.left.getText(parsed) === 'config.automaticDeadline') expressions.push(node.right.getText(parsed));
  ts.forEachChild(node, visit);
 }
 visit(parsed);
 expect(expressions).toHaveLength(1);
 return expressions[0];
}

it('uses exact Run demo briefs and schedules every design once per contrasting mandate',async()=>{
 const cases=await demoCases();const plan=matrixPlan(cases);
 expect(cases.map(c=>c.slug)).toEqual(['packaging','veterinary','software']);
 expect(cases.every(c=>c.input.fromBrief&&c.mandate.filters.brief.naturalLanguage===c.mandate.natural_language)).toBe(true);
 expect(plan).toHaveLength(18);expect(new Set(plan.map(p=>`${p.case}:${p.design}`)).size).toBe(18);
 for(const c of cases)expect(plan.filter(p=>p.case===c.slug).map(p=>p.design).sort()).toEqual(['A','B','C','D','E','F']);
});

it('applies common limits only to ordinary isolated workloads while retaining reviewed company and page limits',()=>{
 const files=workloadFiles;
 const original=workloadSource();
 const source=benchmarkWorkloadSources({...original},{companies:20,minutes:10});
 for (const companies of [20, 7]) {
  const rewritten=benchmarkWorkloadSources({...original},{companies,minutes:7});
  const limits=propertyExpressions(rewritten[files[0]],'maxCompanies');
  expect(limits).toHaveLength(3);
  const [hybrid,web,firmable]=limits.map(value=>new Function('initial','return ('+value+');'));
  for (const evaluate of [hybrid,web,firmable]) expect(evaluate({config:{}})).toBe(companies);
  expect(web({config:{nativeAgent:{},targetBusinesses:800}})).toBe(companies);
  for (const targetBusinesses of [7,20,800]) {
   for (const evaluate of [hybrid,firmable]) expect(evaluate({config:{nativeAgent:{},targetBusinesses}})).toBe(Math.min(targetBusinesses,20));
   expect(hybrid({config:{companyDiscoveryPolicy:{version:3},targetBusinesses}})).toBe(Math.min(targetBusinesses,20));
  }
  for (const version of [4,5]) for (const maxProfiledCompanies of [20,800]) {
   const config={companyDiscoveryPolicy:{version,maxProfiledCompanies},targetBusinesses:20};
   expect(hybrid({config})).toBe(maxProfiledCompanies);
   expect(hybrid({config:{...config,nativeAgent:{}}})).toBe(maxProfiledCompanies);
  }
  const pages=propertyExpressions(rewritten[files[0]],'pageSize');expect(pages).toHaveLength(1);
  const pageSize=new Function('initial','return ('+pages[0]+');');
  expect(pageSize({config:{}})).toBe(companies);
  expect(pageSize({config:{nativeAgent:{},targetBusinesses:800}})).toBe(20);
  expect(pageSize({config:{nativeAgent:{},targetBusinesses:7}})).toBe(7);
 }
 expect(source[files[1]]).toContain('DISCOVERY_CANDIDATE_LIMIT = 20');
 expect(source[files[3]]).toContain('if (selectedDomains.size >= 20) return;');
 expect(source[files[4]]).toContain('discovery.targets.slice(0, 20)');
 for(const file of files)expect(readFileSync(file,'utf8')).toBe(original[file]);
 expect(()=>benchmarkWorkloadSources({...original,[files[0]]:''},{companies:20,minutes:10})).toThrow('no longer matches');
 expect(()=>benchmarkWorkloadSources({...original},{companies:0,minutes:10})).toThrow('Invalid');
});

it('overrides only the ordinary moved launch deadline and preserves native and reviewed policy durations',()=>{
 const original=workloadSource(),file='src/lib/start-mandate-research.ts';
 expect(workloadFiles).toContain(file);
 const rewritten=benchmarkWorkloadSources({...original},{companies:7,minutes:7});
 const evaluate=new Function('config','combined','Date','return ('+deadlineExpression(rewritten[file])+');');
 const duration=config=>evaluate(config,config.companyDiscoveryPolicy?.version===5,{now:()=>0})/60000;
 const automaticLimits=propertyExpressions(rewritten['src/domain/automatic-research.ts'],'automaticDeadline');expect(automaticLimits).toHaveLength(1);
 const automatic=new Function('config','effort','Date','return ('+automaticLimits[0]+');');
 const automaticDuration=config=>automatic(config,{minutes:11},{now:()=>0})/60000;
 expect(duration({})).toBe(7);
 expect(automaticDuration({})).toBe(7);
 expect(duration({nativeAgent:{}})).toBe(10);
 expect(automaticDuration({nativeAgent:{}})).toBe(11);
 for (const version of [3,4,5]) for (const maxProfiledCompanies of [20,800]) {
  expect(duration({companyDiscoveryPolicy:{version,maxProfiledCompanies}})).toBe(version===5?15:10);
  expect(duration({nativeAgent:{},companyDiscoveryPolicy:{version,maxProfiledCompanies}})).toBe(version===5?15:10);
  expect(automaticDuration({companyDiscoveryPolicy:{version,maxProfiledCompanies}})).toBe(11);
 }
 for(const file of workloadFiles)expect(readFileSync(file,'utf8')).toBe(original[file]);
});

it('fails closed when reviewed engine or moved deadline architecture no longer matches exactly',()=>{
 const original=workloadSource(),index='cloudflare/research/index.ts',launch='src/lib/start-mandate-research.ts';
 const mutations=[
  [index,text=>text.replace('maxCompanies:(initial.config.companyDiscoveryPolicy?.version===4||initial.config.companyDiscoveryPolicy?.version===5)?','maxCompanies:(initial.config.companyDiscoveryPolicy?.version===4||initial.config.companyDiscoveryPolicy?.version===6)?')],
  [index,text=>text.replace('maxCompanies:initial.config.nativeAgent?Math.min(initial.config.targetBusinesses||20,20):100','maxCompanies:initial.config.nativeAgent?Math.min(initial.config.targetBusinesses||20,21):100')],
  [index,text=>text.replace('pageSize:initial.config.nativeAgent?Math.min(initial.config.targetBusinesses||20,20):100','pageSize:initial.config.nativeAgent?Math.min(initial.config.targetBusinesses||20,21):100')],
  [index,text=>text+'\nmaxCompanies:100'],
  [launch,text=>text.replace('const combined=config.companyDiscoveryPolicy?.version===5;','const combined=config.companyDiscoveryPolicy?.version===6;')],
  [launch,text=>text.replace('config.automaticDeadline=Date.now()+(combined?15:10)*60000','config.automaticDeadline=Date.now()+(combined?16:10)*60000')],
 ];
 for (const [file,mutate] of mutations) {
  expect(typeof original[file]).toBe('string');
  const changed=mutate(original[file]);expect(changed).not.toBe(original[file]);
  expect(()=>benchmarkWorkloadSources({...original,[file]:changed},{companies:7,minutes:7})).toThrow('no longer matches');
 }
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
