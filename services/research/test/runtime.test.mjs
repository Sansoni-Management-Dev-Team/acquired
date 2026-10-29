import {test} from 'node:test';
import assert from 'node:assert/strict';
import {durationMs, workflowBinding, workflowStep} from '../src/runtime.mjs';

test('Cloudflare durations and retry count retain their meaning', async () => {
  assert.equal(durationMs('120 seconds'),120000);
  assert.equal(durationMs(125),125);
  assert.throws(()=>durationMs('forever'));
  let options;
  const step=workflowStep({runStep:async(fn,config)=>{options=config;return fn()},sleep:async()=>{}});
  assert.equal(await step.do('company',{retries:{limit:2,delay:'12 seconds',backoff:'exponential'},timeout:'120 seconds'},async()=>42),42);
  assert.equal(options.maxAttempts,3);
  assert.equal(options.intervalSeconds,12);
  assert.equal(options.timeoutMS,120000);
});

test('duplicate dispatch retains original workflow and rejects changed input', async () => {
  const jobs=new Map();let starts=0;
  const engine={getWorkflowStatus:async id=>jobs.get(id)||null,startWorkflow:(_fn,options)=>async payload=>{starts++;jobs.set(options.workflowID,{status:'ENQUEUED',input:[payload]});return{}},cancelWorkflow:async()=>{}};
  const binding=workflowBinding(engine,'firmable',async()=>{},'research');
  await binding.createBatch([{id:'one',params:{runId:'one',mandateId:'a'}}]);
  await binding.createBatch([{id:'one',params:{runId:'one',mandateId:'a'}}]);
  assert.equal(starts,1);
  await assert.rejects(binding.createBatch([{id:'one',params:{runId:'one',mandateId:'b'}}]),/conflict/);
  assert.deepEqual(await (await binding.get('one')).status(),{status:'queued'});
  await assert.rejects((await binding.get('missing')).status(),/not found/);
});

test('durable waits use the engine, not an in-memory timer',async()=>{
  const sleeps=[];const step=workflowStep({runStep:async fn=>fn(),sleep:async ms=>sleeps.push(ms)});
  await step.sleep('cooldown','2 seconds');assert.deepEqual(sleeps,[2000]);
});
test('recovery resumes the original workflow and its checkpoints without creating another identity',async()=>{
 const resumed=[],engine={getWorkflowStatus:async()=>({status:'MAX_RECOVERY_ATTEMPTS_EXCEEDED'}),resumeWorkflow:async(...args)=>resumed.push(args)};
 const binding=workflowBinding(engine,'research',()=>{},'research');
 await(await binding.get('saved-job')).restart();
 assert.deepEqual(resumed,[['research:saved-job',{queueName:'research'}]]);
});
test('recovery cannot restart a successful, permanently failed or currently owned workflow',async()=>{
 for(const status of ['SUCCESS','ERROR','PENDING','ENQUEUED','DELAYED']){
  let calls=0;const engine={getWorkflowStatus:async()=>({status}),resumeWorkflow:async()=>{calls++}};
  await(await workflowBinding(engine,'research',()=>{},'research').get('saved-job')).restart();assert.equal(calls,0,status);
 }
});
