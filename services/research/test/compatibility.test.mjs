import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker,{FirmableRefresh,AcquireResearch} from '../dist/worker.mjs';
import {fixture} from './fixture.mjs';
const id='11111111-1111-4111-8111-111111111111';
const secret='test-secret-with-at-least-32-characters';
test('original dispatch contract enforces authentication and validates Firmable input',async()=>{
  const research=[],firmable=[];
  const env={SERVICE_SECRET:secret,RESEARCH:{createBatch:async items=>research.push(...items)},FIRMABLE:{createBatch:async items=>firmable.push(...items)}};
  const request=(path,body,token=secret)=>new Request(`http://localhost${path}`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await worker.fetch(request(`/jobs/${id}`,{},'wrong'),env)).status,401);
  assert.equal(research.length,0);
  const response=await worker.fetch(request(`/jobs/${id}`,{}),env);
  assert.equal(response.status,202);assert.deepEqual(await response.json(),{id});
  assert.deepEqual(research,[{id,params:{jobId:id}}]);
  assert.equal((await worker.fetch(request(`/firmable/${id}`,{mandateId:id}),env)).status,202);
  assert.deepEqual(firmable,[{id,params:{runId:id,mandateId:id}}]);
  assert.equal((await worker.fetch(request(`/firmable/${id}`,{mandateId:'invalid'}),env)).status,400);
  assert.equal((await worker.fetch(request('/unknown',{}),env)).status,404);
});
test('unchanged workflows complete against authenticated synthetic callbacks',async t=>{
  const server=fixture(secret);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve)}));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const env={APP_ORIGIN:origin,SERVICE_SECRET:secret,LOCAL_DEVELOPMENT:'true',LOCAL_RESEARCH_POLICY:'local'};
  const saved=new Map();const step={do:async(name,_options,fn)=>{if(!saved.has(name))saved.set(name,await fn());return saved.get(name)},sleep:async()=>{}};
  const run=new FirmableRefresh({},env);
  assert.deepEqual(await run.run({payload:{runId:id,mandateId:id}},step),{complete:true});
  const calls=()=>fetch(`${origin}/test/calls`,{headers:{authorization:`Bearer ${secret}`}}).then(r=>r.json());
  assert.deepEqual((await calls()).map(c=>c.body.action),['company','people-page','finalize-search','profiles','complete']);
  // Named-checkpoint characterization; this does not prove DBOS crash recovery.
  await run.run({payload:{runId:id,mandateId:id}},step);assert.equal((await calls()).length,5);
  await new AcquireResearch({},env).run({payload:{jobId:id}},{do:async(_name,_options,fn)=>fn(),sleep:async()=>{}});
  assert.ok((await calls()).some(c=>c.body.action==='company-background-research'));
});
