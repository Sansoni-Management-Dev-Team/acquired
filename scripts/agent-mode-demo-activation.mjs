import{assertAgentModeNamespaceActivation,exactMissingAgentContainer}from'./agent-mode-namespace-activation.mjs';import{assertAgentModeRestartIdle}from'./agent-mode-restart-guard.mjs';
const names={network:'project-acquire-agent-demo-network','communications-demo':'project-acquire-agent-communications-demo','simulator-demo-bridge':'project-acquire-agent-simulator-demo-bridge','app-demo-relay':'project-acquire-agent-app-demo-relay'};
const format='{"id":"{{.Id}}","name":"{{.Name}}","networkMode":"{{.HostConfig.NetworkMode}}","running":{{.State.Running}},"paused":{{.State.Paused}},"labels":{{json .Config.Labels}}}';
export function activateAgentModeDemos({composeFile,compose,runDocker,observeIdle,writeConfiguration}){
 const execute=args=>{const r=runDocker(args);if(r.status!==0)throw Error('Additive demo activation failed; native worker remains stopped');return r;};
 function inspect(name,service,missing=false){const r=runDocker(['--context','orbstack','inspect',name,'--format',format]);if(r.status!==0){if(missing&&exactMissingAgentContainer(r,name))return null;throw Error('Exact demo activation ownership unavailable');}let v;try{v=JSON.parse(r.stdout);}catch{throw Error('Exact demo activation ownership unavailable');}if(!/^[a-f0-9]{64}$/.test(v.id)||v.name!=='/'+name||v.labels?.['com.docker.compose.project']!=='acquire-agent-mode'||v.labels?.['com.docker.compose.service']!==service||!v.labels?.['com.docker.compose.project.config_files']?.split(',').includes(composeFile)||v.paused)throw Error('Exact demo activation ownership unavailable');return v;}
 // Never adopt/recreate the existing primary namespace or its research sidecars.
 assertAgentModeNamespaceActivation({composeFile,runDocker});
 const primary=inspect('project-acquire-agent-network','network'),worker=inspect('project-acquire-agent-worker','agent');if(worker.networkMode!=='container:'+primary.id)throw Error('Native worker namespace differs');
 const previousRunning=worker.running===true;if(previousRunning)execute(['--context','orbstack','stop',worker.id]);
 const idle=observeIdle();assertAgentModeRestartIdle(idle);if(idle.runningJournals!==0)throw Error('Additive demo activation requires no claimed/dispatching journal');
 const stopped=inspect('project-acquire-agent-worker','agent');if(stopped.running!==false)throw Error('Native worker must remain stopped');
 const owner=inspect(names.network,'demo-network',true);if(owner&&owner.running!==true)throw Error('Existing demo namespace needs separate review');
 for(const service of['communications-demo','simulator-demo-bridge','app-demo-relay'])inspect(names[service],service,true);
 writeConfiguration();
 if(!owner)execute([...compose,'up','-d','--no-deps','demo-network']);
 execute([...compose,'up','-d','--no-deps','--force-recreate','communications-demo','simulator-demo-bridge','app-demo-relay']);
 const health=`(async()=>{for(let n=0;n<60;n++){try{const r=await fetch('https://127.0.0.1:5891/health',{signal:AbortSignal.timeout(1000)});if(r.ok){console.log('Demo service healthy');return;}}catch{}await new Promise(r=>setTimeout(r,500));}process.exit(1);})()`;
 execute(['--context','orbstack','exec','project-acquire-agent-mode','node','-e',health]);
 execute([...compose,'up','-d','--no-deps','--force-recreate','app']);
 const appHealth=`(async()=>{for(let n=0;n<120;n++){try{const r=await fetch('http://127.0.0.1:3000/api/auth/get-session',{signal:AbortSignal.timeout(1000)});if(r.ok){console.log('Application ready');return;}}catch{}await new Promise(r=>setTimeout(r,500));}process.exit(1);})()`;
 execute(['--context','orbstack','exec','project-acquire-agent-mode','node','-e',appHealth]);
 assertAgentModeNamespaceActivation({composeFile,runDocker});
 if(previousRunning)execute(['--context','orbstack','start',stopped.id]);
 return{ready:true,workerResumed:previousRunning,primaryNamespacePreserved:true,researchRestarted:false};
}
