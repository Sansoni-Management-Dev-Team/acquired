import {resolve,dirname,basename,isAbsolute} from 'node:path';

const prefix=['--context','orbstack'];
const names={app:'project-acquire-agent-mode',network:'project-acquire-agent-network'};
const overlays=new Set(['compose.local.yml','compose.simulator.yml','compose.simulator25.yml','compose.simulator50.yml','compose.multichannel.yml']);
const format='{"id":{{json .Id}},"name":{{json .Name}},"networkMode":{{json .HostConfig.NetworkMode}},"labels":{{json .Config.Labels}},"running":{{json .State.Running}},"paused":{{json .State.Paused}}}';
const refuse=()=>{throw Error('Namespace topology cannot be activated ordinarily; use --restart-app or --leave-worker-stopped after inspecting the exact local stack.');};
const invalid=()=>{throw Error('Cannot verify exact worktree-owned Agent mode containers; no startup action was taken.');};

/** Read-only host-side activation fence. No Docker socket, environment values,
 * database access, retry, process stop or lifecycle mutation is performed here. */
export function assertAgentModeNamespaceActivation({runDocker,composeFile,controlled=false}){
 if(typeof runDocker!=='function'||typeof composeFile!=='string'||!isAbsolute(composeFile)||basename(composeFile)!=='compose.local.yml'||typeof controlled!=='boolean')invalid();
 const directory=dirname(resolve(composeFile));
 const read=service=>{
  let result;try{result=runDocker([...prefix,'container','inspect','--format',format,names[service]]);}catch{invalid();}
  if(result?.status!==0){
   const error=typeof result?.stderr==='string'?result.stderr.trim():'';
   if(result?.status===1&&typeof result.stdout==='string'&&!result.stdout.trim()&&[`Error: No such object: ${names[service]}`,`Error response from daemon: No such container: ${names[service]}`,`Error: No such container: ${names[service]}`].includes(error))return null;
   invalid();
  }
  let value;try{value=JSON.parse(result.stdout);}catch{invalid();}
  const labels=value?.labels,files=typeof labels?.['com.docker.compose.project.config_files']==='string'?labels['com.docker.compose.project.config_files'].split(','):[];
  if(!value||!/^[a-f0-9]{64}$/.test(value.id)||value.name!=='/'+names[service]||typeof value.networkMode!=='string'||typeof value.running!=='boolean'||typeof value.paused!=='boolean'||labels?.['com.docker.compose.project']!=='acquire-agent-mode'||labels?.['com.docker.compose.service']!==service||!files.includes(composeFile)||files.some(file=>!isAbsolute(file)||dirname(resolve(file))!==directory||!overlays.has(basename(file))))invalid();
  return value;
 };
 const app=read('app'),network=read('network');
 // Even an otherwise controlled activation may never mutate a container owned
 // by another worktree. Only the topology comparison is bypassed below.
 if(controlled)return {fresh:!app,controlled:true};
 if(!app)return {fresh:true,controlled:false};
 if(!network||app.networkMode!=='container:'+network.id||!network.running||network.paused||!app.running||app.paused)refuse();
 const namespace=container=>{
  let result;try{result=runDocker([...prefix,'exec',container.id,'readlink','/proc/self/ns/net']);}catch{refuse();}
  const value=typeof result?.stdout==='string'?result.stdout.trim():'';
  if(result?.status!==0||!/^net:\[\d+\]$/.test(value))refuse();
  return value;
 };
 // Container IDs alone cannot identify a namespace after an owner restarts.
 if(namespace(app)!==namespace(network))refuse();
 return {fresh:false,controlled:false};
}
