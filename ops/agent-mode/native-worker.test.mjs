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
