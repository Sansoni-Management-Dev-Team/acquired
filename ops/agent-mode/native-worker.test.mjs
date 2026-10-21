import {test} from 'node:test';
import assert from 'node:assert/strict';
import {requestNativeTick} from './native-worker.mjs';
test('local worker uses only the fixed loopback endpoint and authenticated header',async()=>{
 let request;const result=await requestNativeTick({secret:'synthetic-worker-secret',fetcher:async(url,options)=>{request={url,options};return Response.json({enabled:true,processed:1,outcome:'complete'});}});
 assert.deepEqual(result,{enabled:true,processed:1,outcome:'complete'});assert.equal(request.url,'http://127.0.0.1:3000/api/internal/agent/tick');assert.equal(request.options.headers.authorization,'Bearer synthetic-worker-secret');assert.equal(request.options.method,'POST');
});
test('missing worker credentials never reach the app',async()=>{let called=false;await assert.rejects(requestNativeTick({secret:'',fetcher:async()=>{called=true;return Response.json({});}}));assert.equal(called,false);});
test('failed or malformed responses produce generic errors instead of echoing server bodies',async()=>{
 for(const response of [new Response('private server body',{status:500}),Response.json({enabled:true,processed:9999}),Response.json({enabled:true,processed:1,outcome:'invented'})])await assert.rejects(requestNativeTick({secret:'synthetic',fetcher:async()=>response}),error=>!error.message.includes('private'));
});
test('an aborted worker does not start another tick',async()=>{const controller=new AbortController();controller.abort();let called=false;await assert.rejects(requestNativeTick({secret:'synthetic',signal:controller.signal,fetcher:async()=>{called=true;return Response.json({});}}));assert.equal(called,false);});

test('scheduled research maintenance uses its own credential, exact existing endpoint/body and 15-second bound',async t=>{
 const {requestResearchMaintenance}=await import('./native-worker.mjs');let request,timeoutMs;
 t.mock.method(AbortSignal,'timeout',ms=>{timeoutMs=ms;return new AbortController().signal;});
 const value=await requestResearchMaintenance({secret:'synthetic-research-secret',fetcher:async(url,options)=>{request={url,options};return Response.json({pending:2});}});
 assert.deepEqual(value,{pending:2});assert.equal(request.url,'http://127.0.0.1:3000/api/research/internal/background');assert.equal(request.options.method,'POST');assert.equal(request.options.redirect,'manual');assert.equal(request.options.headers.authorization,'Bearer synthetic-research-secret');assert.equal(request.options.headers['Content-Type'],'application/json');assert.deepEqual(JSON.parse(request.options.body),{trigger:'scheduled'});assert.equal(timeoutMs,15000);
});
test('maintenance rejects missing credentials, failed receipts and aborted shutdown without echoing private bodies',async()=>{
 const {requestResearchMaintenance}=await import('./native-worker.mjs');let calls=0;const fetcher=async()=>{calls++;return Response.json({pending:0});};
 await assert.rejects(requestResearchMaintenance({secret:'',fetcher}));assert.equal(calls,0);
 for(const response of[new Response('private credential body',{status:403}),Response.json({pending:-1}),Response.json({pending:'2'})])await assert.rejects(requestResearchMaintenance({secret:'synthetic',fetcher:async()=>response}),e=>!e.message.includes('private'));
 const controller=new AbortController();controller.abort();await assert.rejects(requestResearchMaintenance({secret:'synthetic',signal:controller.signal,fetcher}));assert.equal(calls,0);
});
function scheduler(){const waits=[];return{waits,sleep:(ms,_value,{signal})=>new Promise((resolve,reject)=>{const stop=()=>reject(signal.reason);signal.addEventListener('abort',stop,{once:true});waits.push({ms,release:()=>{signal.removeEventListener('abort',stop);resolve();}});})};}
const settled=()=>new Promise(resolve=>setImmediate(resolve));
test('maintenance runs once per minute while a native tick is pending and shares abort shutdown',async()=>{
 const {runNativeWorker}=await import('./native-worker.mjs'),controller=new AbortController(),clock=scheduler(),logs=[];let ticks=0,maintenance=0,now=0;
 const work=runNativeWorker({nativeSecret:'native-private',researchSecret:'research-private',signal:controller.signal,sleep:clock.sleep,now:()=>now,log:e=>logs.push(e),nativeTick:async({signal,secret})=>{assert.equal(secret,'native-private');ticks++;return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));},maintenance:async({signal,secret})=>{assert.equal(signal,controller.signal);assert.equal(secret,'research-private');maintenance++;return{pending:0};}});
 await settled();assert.equal(ticks,1);assert.equal(maintenance,1);assert.equal(clock.waits[0].ms,60000);
 now=60000;clock.waits.shift().release();await settled();assert.equal(maintenance,2);assert.equal(ticks,1);assert.equal(clock.waits[0].ms,60000);
 controller.abort();await work;assert.equal(maintenance,2);assert.equal(ticks,1);assert.equal(logs.filter(x=>x.stage==='research.maintenance'&&x.outcome==='complete').length,2);assert.ok(!JSON.stringify(logs).includes('private'));
});
test('native failures do not starve maintenance and maintenance cannot overlap itself or alter native cadence',async()=>{
 const {runNativeWorker}=await import('./native-worker.mjs'),controller=new AbortController(),clock=scheduler(),logs=[];let ticks=0,maintenance=0,finish;
 const work=runNativeWorker({signal:controller.signal,sleep:clock.sleep,log:e=>logs.push(e),nativeTick:async()=>{ticks++;throw Error('PRIVATE native failure');},maintenance:async({signal})=>{maintenance++;return new Promise((resolve,reject)=>{finish=()=>resolve({pending:1});signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});}});
 await settled();assert.equal(ticks,1);assert.equal(maintenance,1);assert.deepEqual(clock.waits.map(w=>w.ms),[1000]);
 clock.waits.shift().release();await settled();assert.equal(ticks,2);assert.equal(maintenance,1);assert.deepEqual(clock.waits.map(w=>w.ms),[2000]);
 finish();await settled();assert.equal(maintenance,1);assert.ok(clock.waits.some(w=>w.ms>59000&&w.ms<=60000));controller.abort();await work;assert.ok(!JSON.stringify(logs).includes('PRIVATE'));
});
test('a maintenance failure remains a once-minute safe error while native work continues, and pre-aborted workers do nothing',async()=>{
 const {runNativeWorker}=await import('./native-worker.mjs'),controller=new AbortController(),clock=scheduler(),logs=[];let ticks=0,maintenance=0;
 const work=runNativeWorker({signal:controller.signal,sleep:clock.sleep,now:()=>0,log:e=>logs.push(e),nativeTick:async()=>{ticks++;return{enabled:true,processed:0};},maintenance:async()=>{maintenance++;throw Error('PRIVATE maintenance credential/body');}});
 await settled();assert.equal(ticks,1);assert.equal(maintenance,1);assert.deepEqual(clock.waits.map(w=>w.ms).sort((a,b)=>a-b),[30000,60000]);
 clock.waits.find(w=>w.ms===30000).release();await settled();assert.equal(ticks,2);assert.equal(maintenance,1);assert.ok(logs.some(e=>e.stage==='research.maintenance'&&e.outcome==='error'));assert.ok(!JSON.stringify(logs).includes('PRIVATE'));
 controller.abort();await work;await runNativeWorker({signal:controller.signal,nativeTick:async()=>{throw Error('Must not call');},maintenance:async()=>{throw Error('Must not call');}});
});

test('idle native polling backs off from30 to60seconds without overlapping maintenance',async()=>{
 const {runNativeWorker}=await import('./native-worker.mjs'),controller=new AbortController(),clock=scheduler();let ticks=0;
 const work=runNativeWorker({signal:controller.signal,sleep:clock.sleep,nativeTick:async()=>{ticks++;return{enabled:true,processed:0,outcome:'idle'};},maintenance:async()=>({pending:0})});
 try{await settled();assert.equal(ticks,1);const first=clock.waits.find(w=>w.ms!==60000);assert.equal(first.ms,30000);first.release();await settled();assert.equal(ticks,2);assert.equal(clock.waits.at(-1).ms,60000);clock.waits.at(-1).release();await settled();assert.equal(ticks,3);assert.equal(clock.waits.at(-1).ms,60000);}finally{controller.abort();await work;}
});
test('a burst drains at most five ordinary ticks, stays sequential and returns to short polling',async()=>{
 const {runNativeWorker}=await import('./native-worker.mjs'),controller=new AbortController(),clock=scheduler();let ticks=0,active=0,maxActive=0;
 const work=runNativeWorker({signal:controller.signal,sleep:clock.sleep,nativeTick:async()=>{ticks++;active++;maxActive=Math.max(maxActive,active);await settled();active--;return{enabled:true,processed:1,outcome:'complete'};},maintenance:async()=>({pending:0})});
 try{for(let i=0;i<8;i++)await settled();assert.equal(ticks,5);assert.equal(maxActive,1);assert.equal(clock.waits.at(-1).ms,1000);}finally{controller.abort();await work;}
});
test('work found after an idle backoff resets the next idle delay to30seconds',async()=>{
 const {runNativeWorker}=await import('./native-worker.mjs'),controller=new AbortController(),clock=scheduler();let calls=0;
 const work=runNativeWorker({signal:controller.signal,sleep:clock.sleep,nativeTick:async()=>({enabled:true,processed:++calls===3?1:0,outcome:calls===3?'complete':'idle'}),maintenance:async()=>({pending:0})});
 try{await settled();clock.waits.find(w=>w.ms===30000).release();await settled();clock.waits.at(-1).release();await settled();assert.equal(calls,4);assert.equal(clock.waits.at(-1).ms,1000);clock.waits.at(-1).release();await settled();assert.equal(calls,5);assert.equal(clock.waits.at(-1).ms,30000);}finally{controller.abort();await work;}
});
test('a burst stops starting new ticks after its10second start budget',async()=>{
 const {runNativeWorker}=await import('./native-worker.mjs'),controller=new AbortController(),clock=scheduler();let ticks=0,now=0;
 const work=runNativeWorker({signal:controller.signal,sleep:clock.sleep,now:()=>now,nativeTick:async()=>{ticks++;now+=6000;return{enabled:true,processed:1,outcome:'complete'};},maintenance:async()=>({pending:0})});
 try{await settled();assert.equal(ticks,2);assert.equal(clock.waits.at(-1).ms,1000);}finally{controller.abort();await work;}
});
test('review, deferred and lost outcomes end their burst without retrying the same work immediately',async()=>{
 const {runNativeWorker}=await import('./native-worker.mjs');
 for(const outcome of['review','defer','lost']){const controller=new AbortController(),clock=scheduler();let calls=0;const work=runNativeWorker({signal:controller.signal,sleep:clock.sleep,nativeTick:async()=>{calls++;return{enabled:true,processed:1,outcome};},maintenance:async()=>({pending:0})});try{await settled();assert.equal(calls,1);assert.ok(clock.waits.some(w=>w.ms===1000));}finally{controller.abort();await work;}}
});
test('explicit fast-test polling keeps one-second idle checks',async()=>{
 const {runNativeWorker}=await import('./native-worker.mjs'),controller=new AbortController(),clock=scheduler();
 const work=runNativeWorker({pollingMode:'fast-test',signal:controller.signal,sleep:clock.sleep,nativeTick:async()=>({enabled:true,processed:0,outcome:'idle'}),maintenance:async()=>({pending:0})});
 try{await settled();assert.ok(clock.waits.some(w=>w.ms===1000));}finally{controller.abort();await work;}
});
test('polling mode is adaptive by default and fast only for the explicit local simulator policy',async()=>{
 const {nativeWorkerPollingMode}=await import('./native-worker.mjs');
 assert.equal(nativeWorkerPollingMode({}),'adaptive');assert.equal(nativeWorkerPollingMode({NODE_ENV:'production',AGENT_MODE_SIMULATOR_TEST_POLICY:'true'}),'adaptive');assert.equal(nativeWorkerPollingMode({NODE_ENV:'development',AGENT_MODE_COMMUNICATIONS_MODE:'simulator',AGENT_MODE_SIMULATOR_TEST_POLICY:'true'}),'fast-test');
});
test('idle logs describe cadence changes without logging each empty poll',async()=>{
 const {runNativeWorker}=await import('./native-worker.mjs'),controller=new AbortController(),clock=scheduler(),logs=[];
 const work=runNativeWorker({signal:controller.signal,sleep:clock.sleep,log:e=>logs.push(e),nativeTick:async()=>({enabled:true,processed:0,outcome:'idle'}),maintenance:async()=>({pending:0})});
 try{await settled();clock.waits.find(w=>w.ms===30000).release();await settled();clock.waits.at(-1).release();await settled();const cadence=logs.filter(e=>e.stage==='native.polling');assert.deepEqual(cadence.map(e=>e.delayMs),[30000,60000]);assert.ok(cadence.every(e=>e.mode==='adaptive'));}finally{controller.abort();await work;}
});
test('shutdown during a completed event does not start the next event in the burst',async()=>{
 const {runNativeWorker}=await import('./native-worker.mjs'),controller=new AbortController();let calls=0;
 await runNativeWorker({signal:controller.signal,log:()=>{},nativeTick:async()=>{calls++;controller.abort();return{enabled:true,processed:1,outcome:'complete'};},maintenance:async()=>({pending:0})});assert.equal(calls,1);
});
test('continued failures back off to60seconds and abort cancels that sleep',async()=>{
 const {runNativeWorker}=await import('./native-worker.mjs'),controller=new AbortController(),clock=scheduler();let calls=0;
 const work=runNativeWorker({signal:controller.signal,sleep:clock.sleep,log:()=>{},nativeTick:async()=>{calls++;throw Error('Private failure');},maintenance:async()=>new Promise((_resolve,reject)=>controller.signal.addEventListener('abort',()=>reject(controller.signal.reason),{once:true}))});
 try{await settled();for(const ms of[1000,2000,4000,8000,16000,32000]){assert.equal(clock.waits.at(-1).ms,ms);clock.waits.at(-1).release();await settled();}assert.equal(calls,7);assert.equal(clock.waits.at(-1).ms,60000);}finally{controller.abort();await work;}
});
