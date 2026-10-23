import {test} from 'node:test';import assert from 'node:assert/strict';
import * as activation from './agent-mode-namespace-activation.mjs';
const composeFile='/isolated/fixes/ops/agent-mode/compose.local.yml',idleObservation={database:'acquire_agent_mode',marker:'acquire-agent-mode-local-only',runningOperations:0,runningRuns:0};
function fixture({legacy=true,workerRunning=false,foreign=false,workerForeign=false,workerPaused=false,appAbsent=false,failStop=false}={}){
 const calls=[],records={app:{id:'a'.repeat(64),name:'/project-acquire-agent-mode',networkMode:legacy?'acquire-agent-mode_default':'container:'+'b'.repeat(64),running:true,paused:false},agent:{id:'c'.repeat(64),name:'/project-acquire-agent-worker',networkMode:'container:'+'a'.repeat(64),running:workerRunning,paused:false}};
 if(!legacy)records.network={id:'b'.repeat(64),name:'/project-acquire-agent-network',networkMode:'default',running:true,paused:false};
 for(const [service,r]of Object.entries(records))r.labels={'com.docker.compose.project':'acquire-agent-mode','com.docker.compose.service':service,'com.docker.compose.project.config_files':foreign?'/foreign/ops/agent-mode/compose.local.yml':composeFile};
 if(workerForeign)records.agent.labels={...records.agent.labels,'com.docker.compose.project.config_files':'/foreign/ops/agent-mode/compose.local.yml'};
 records.agent.paused=workerPaused;
 if(appAbsent)delete records.app;
 let oldPortsBound=legacy&&!appAbsent;
 const runDocker=args=>{calls.push(args);if(args.includes('inspect')){const record=Object.values(records).find(r=>r.name==='/'+args.at(-1));return record?{status:0,stdout:JSON.stringify(record)}:{status:1,stdout:'',stderr:'Error: No such object: '+args.at(-1)};}
 if(args.includes('stop')){assert.equal(args.at(-1),records.app.id,'only inspected immutable app ID may stop');if(failStop)return{status:1,stderr:'private sentinel'};oldPortsBound=false;records.app.running=false;return{status:0,stdout:records.app.id};}throw Error('Unexpected command');};
 return{calls,runDocker,startNewNetwork(){if(oldPortsBound)throw Error('Host ports3026/5462/5792 already allocated');}};
}
test('controlled migration releases actual fake host-port ownership before new network startup',()=>{
 const f=fixture();assert.throws(()=>f.startNewNetwork(),/already allocated/);
 const result=activation.stopAgentModeLegacyNamespace?.({composeFile,runDocker:f.runDocker,controlled:true,idleObservation});
 assert.doesNotThrow(()=>f.startNewNetwork(),'old app must release published ports BEFORE network up');assert.deepEqual(result,{stopped:true});
 assert.equal(f.calls.filter(a=>a.includes('stop')).length,1);
});
test('ordinary startup, foreign ownership, live worker and nonidle DB never stop a container',()=>{
 for(const patch of [{controlled:false},{foreign:true},{workerForeign:true},{workerRunning:true},{workerPaused:true},{idleObservation:{...idleObservation,runningRuns:1}},{idleObservation:{...idleObservation,runningOperations:1}},{idleObservation:{...idleObservation,marker:'wrong'}},{idleObservation:undefined}]){
  const f=fixture(patch);assert.throws(()=>activation.stopAgentModeLegacyNamespace({composeFile,runDocker:f.runDocker,controlled:true,idleObservation,...patch}));assert.equal(f.calls.filter(a=>a.includes('stop')).length,0);
 }
});
test('fresh or already-independent namespace never stops app',()=>{
 for(const options of [{legacy:false},{appAbsent:true}]){const f=fixture(options);assert.deepEqual(activation.stopAgentModeLegacyNamespace({composeFile,runDocker:f.runDocker,controlled:true,idleObservation}),{stopped:false});assert.equal(f.calls.filter(a=>a.includes('stop')).length,0);}
});
test('stop failure is private and prevents claiming the ports are released',()=>{
 const f=fixture({failStop:true});assert.throws(()=>activation.stopAgentModeLegacyNamespace({composeFile,runDocker:f.runDocker,controlled:true,idleObservation}),e=>!e.message.includes('sentinel'));assert.throws(()=>f.startNewNetwork(),/already allocated/);
});
