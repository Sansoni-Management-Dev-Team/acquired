import {afterEach,beforeEach,expect,it,vi} from 'vitest';
vi.mock('cloudflare:workers',()=>({WorkflowEntrypoint:class{env:unknown;constructor(_context:unknown,env:unknown){this.env=env;}},DurableObject:class{}}));
vi.mock('../../src/domain/research-runner',()=>({runResearch:vi.fn()}));
vi.mock('../../src/domain/hybrid-company-pipeline',()=>({runHybridCompanyPipeline:vi.fn(),hybridCompanyPartialResult:vi.fn()}));
import {AcquireResearch} from './index';
import {runResearch} from '../../src/domain/research-runner';
import {runHybridCompanyPipeline} from '../../src/domain/hybrid-company-pipeline';
import type {ResearchControl} from '../../src/domain/research-runner';
import {buildAllDiscoveredCompanyPolicy} from '../../src/domain/research-discovery-policy';

const id='19f57bf3-9a5b-4504-b7e2-d214799761f1';
const trace={jobId:id,mandateId:'mandate-1',runId:'run-1',operationId:'operation-1',requestId:'request-1'};
beforeEach(()=>vi.clearAllMocks());afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});

it.each(['control-start','f-control'])('restores persisted trace from replayed %s without replaying its callback',async checkpoint=>{
 const hybrid=checkpoint==='f-control';
 const config={approved:true,seeds:[],searchTerms:['Refrigeration'],geography:'QLD',discover:false,mode:'automatic',workflow:'business',budget:{maxPages:1,maxDomains:1,maxMinutes:10,maxModelCalls:1},researchRunId:id,...(hybrid?{pipelineDesign:'hybrid-firmable-v1',companyDiscoveryPolicy:buildAllDiscoveredCompanyPolicy()}: {})} as ResearchControl['config'];
 const live:ResearchControl={status:'queued',config,seeds:[],deadline:Date.now()+60000};
 const saved={...live,traceContext:{...trace,jobId:'wrong-diagnostic-job'}};
 const calls:{body:Record<string,unknown>|undefined;headers:Headers;url:string}[]=[];
 const log=vi.spyOn(console,'info').mockImplementation(()=>{});
 vi.stubGlobal('fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input);if(!url.startsWith('http://127.0.0.1:3000/api/research/internal/'+id))throw Error('Unexpected external request');
  const body=init?.body?JSON.parse(String(init.body)):undefined;calls.push({url,body,headers:new Headers(init?.headers)});
  return Response.json(!init?.body?live:body.action==='e-plan'?[]:{ok:true});
 });
 vi.mocked(runResearch).mockImplementation(async(steps,services)=>{await steps.do('ordinary-check',async context=>{expect(context).toBeUndefined();return true;});await steps.do('control-start',async context=>{expect(context).toBeUndefined();return services.control();});await services.progress({status:'complete',revision:1,pages:0,modelCalls:0,message:'Done'});});
 vi.mocked(runHybridCompanyPipeline).mockImplementation(async deps=>{await deps.checkpoint('firmable-attempt-contract',async attempt=>{expect(attempt).toBe(0);return true;});await deps.checkpoint('f-plan',deps.plan);await deps.checkpoint('f-finish',()=>deps.finish({saved:0}));return undefined as never;});
 const step={do:vi.fn(async(name:string,_options:unknown,run:()=>Promise<unknown>)=>name===checkpoint?JSON.stringify(saved):run()),sleep:vi.fn()};
 const workflow=new AcquireResearch({} as never,{SERVICE_SECRET:'test-only',APP_ORIGIN:'http://127.0.0.1:3000',LOCAL_DEVELOPMENT:'true'} as never);
 await workflow.run({payload:{jobId:id}} as never,step as never);
 const action=calls.find(call=>hybrid?call.body?.action==='e-plan':call.body?.revision===1)!;
 expect(action.headers.get('x-acquire-research-job')).toBe(id);
 expect(action.headers.get('x-acquire-mandate-id')).toBe(trace.mandateId);
 expect(action.headers.get('x-acquire-research-run')).toBe(trace.runId);
 expect(action.headers.get('x-acquire-agent-operation')).toBe(trace.operationId);
 expect(calls.filter(call=>call.body===undefined)).toHaveLength(1);
 expect(step.do.mock.calls.map(([name])=>name)).toContain(checkpoint);
 if(hybrid){
  expect(vi.mocked(runHybridCompanyPipeline).mock.calls[0][1].traceContext).toMatchObject(trace);
  expect(calls.find(call=>call.url.endsWith('/timings'))!.headers.get('x-acquire-mandate-id')).toBe(trace.mandateId);
 }else expect(log.mock.calls.map(([,body])=>typeof body==='string'?JSON.parse(body):{}).find(item=>item.status==='complete')).toMatchObject(trace);
});
