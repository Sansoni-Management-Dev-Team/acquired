const dispatchMocks=vi.hoisted(()=>({create:vi.fn(),get:vi.fn(),worker:vi.fn()}));
vi.mock('@/db/client',()=>({requireDb:vi.fn()}));
vi.mock('@/db/research-repository',()=>({ResearchRepository:class{create=dispatchMocks.create;getExecution=dispatchMocks.get;}}));
vi.mock('./research-service',()=>({researchWorker:dispatchMocks.worker}));
import { expect, it, vi } from 'vitest';
import { corpusBusinessTasks } from './corpus-business-research';
import type { ResearchSchedulingSnapshot } from './research-scheduling-snapshot';
const root={id:'root',mandateId:'mandate',status:'partial',seeds:['https://alpha.example.com/'],config:{pipelineDesign:'corpus-v1',researchRunId:'root',parallelBusinessResearch:true,searchTerms:['industrial packaging'],findPeople:true,automaticDeadline:Date.now()+600000}};
const snapshot=()=>({root,jobs:[root],members:[],findings:[],dispatched:new Set()}) as unknown as ResearchSchedulingSnapshot;
it('plans one collection job per company with no initial field or sitemap-page jobs',()=>{const tasks=corpusBusinessTasks(snapshot());expect(tasks).toHaveLength(1);expect(tasks[0].config.researchTask).toBe('company');});
it('waits for collection and qualification, then schedules only fields missing from this run',()=>{
 const s=snapshot();const company=corpusBusinessTasks(s)[0];s.jobs.push({...company,status:'extracting'} as unknown as ResearchSchedulingSnapshot['jobs'][number]);s.members.push({target:{id:'alpha',domain:'alpha.example.com',companyName:'Alpha Packaging'},assessment:{stage:'identified'}} as unknown as ResearchSchedulingSnapshot['members'][number]);
 s.findings.push(...[{kind:'company',name:'Alpha Packaging',value:'Alpha Packaging',website:'https://alpha.example.com/',quote:'# Alpha Packaging',relevance:'unclear'},{kind:'product',name:'Industrial packaging',value:'industrial packaging',quote:'We manufacture industrial packaging.',website:'https://alpha.example.com/',relevance:'relevant'},{kind:'identifier',name:'ABN',value:'51824753556',quote:'ABN 51 824 753 556'}].map(evidence=>({jobId:company.id,targetId:'alpha',sourceUrl:'https://alpha.example.com/',evidence})) as unknown as ResearchSchedulingSnapshot['findings']);
 expect(corpusBusinessTasks(s).every(t=>t.config.researchTask==='company')).toBe(true);
 s.jobs[1].status='complete';expect(corpusBusinessTasks(s).filter(t=>t.config.researchTask==='field').map(t=>t.config.researchField)).toEqual(['size','revenue','people','email']);
 s.findings=s.findings.map(f=>({...f,jobId:'inherited-other-run'}));expect(corpusBusinessTasks(s).filter(t=>t.config.researchTask==='field')).toHaveLength(0);
});
it('reserves collection capacity before spending remaining slots on missing fields',async()=>{const {chooseCorpusTask}=await import('./corpus-business-research');const collection={config:{researchTask:'company',companyDomain:'next.example.com'}},field={config:{researchTask:'field',researchField:'abn'}};expect(chooseCorpusTask([field,collection],[])).toBe(collection);expect(chooseCorpusTask([field,collection],Array.from({length:8},()=>({config:{researchTask:'company'}})))).toBe(field);});

it("caps C at twelve durable jobs and does not duplicate a refill",async()=>{const {dispatchCorpusBusinessResearch}=await import("./corpus-business-research");const s=snapshot();s.root.seeds=Array.from({length:20},(_,i)=>`https://company${i}.example.com/`);dispatchMocks.create.mockClear();dispatchMocks.create.mockImplementation(async(id,mandateId,createdBy,config)=>({id,mandateId,createdBy,config,status:"queued"}));dispatchMocks.get.mockResolvedValue({status:"partial"});await dispatchCorpusBusinessResearch("org","root",s);expect(dispatchMocks.create).toHaveBeenCalledTimes(12);await dispatchCorpusBusinessResearch("org","root",s);expect(dispatchMocks.create).toHaveBeenCalledTimes(12);});
