import {z} from 'zod';
import {agentRecordDigest as digest} from '@/db/agent-store';
import type {SequenceWorkflowProvider,WorkflowSnapshot} from './agent-sequence-publication';
const object=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
function safeUrl(value:string){const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error('Invalid configured workflow URL');return value.replace(/\/$/,'');}
export type NativeN8nConfiguration={url:string;appUrl:string;credentialId?:string};
export function nativeN8nConfiguration():NativeN8nConfiguration{
 const url=safeUrl(z.string().min(1).parse(process.env.CAMPAIGN_N8N_URL)),appUrl=safeUrl(z.string().min(1).parse(process.env.CAMPAIGN_APP_URL)),credentialId=process.env.CAMPAIGN_N8N_WORKER_CREDENTIAL_ID;
 if(process.env.NODE_ENV==='production'&&!credentialId)throw new Error('Production workflow credential is required');
 return {url,appUrl,...(credentialId?{credentialId}:{})};
}
const same=(a:unknown,b:unknown)=>a===undefined||b===undefined?a===b:digest(a)===digest(b);
export function workflowMatches(actual:WorkflowSnapshot,expected:Record<string,unknown>){
 const raw=actual.workflow;if(raw.name!==expected.name||!same(raw.connections,expected.connections)||!Array.isArray(raw.nodes)||!Array.isArray(expected.nodes)||raw.nodes.length!==expected.nodes.length)return false;
 const settings=object(raw.settings),desiredSettings=object(expected.settings);for(const [key,value] of Object.entries(desiredSettings))if(!same(settings[key],value))return false;
 for(const [key,value] of Object.entries(settings))if(!(key in desiredSettings)&&value!==null&&value!==false&&value!==0&&value!==''&&!(key==='callerPolicy'&&value==='workflowsFromSameOwner'))return false;
 const nodes=raw.nodes.map(object);for(const desired of expected.nodes.map(object)){
  const node=nodes.find(item=>item.id===desired.id);if(!node)return false;
  for(const [key,value] of Object.entries(desired))if(!same(node[key],value))return false;
  if(!desired.credentials&&Object.keys(object(node.credentials)).length)return false;
  for(const key of ['disabled','executeOnce','alwaysOutputData','retryOnFail','continueOnFail'])if(node[key]===true&&desired[key]!==true)return false;
  if(node.onError&&node.onError!=='stopWorkflow'&&node.onError!==desired.onError)return false;
 }
 const active=object(raw.activeVersion);if(actual.active&&'activeVersionId' in raw&&(typeof raw.activeVersionId!=='string'||!raw.activeVersionId||active.versionId!==raw.activeVersionId||active.workflowId!==actual.id||!Array.isArray(active.nodes)||!active.connections))return false;
 if(active.nodes){if(!same(active.nodes,raw.nodes)||!same(active.connections,raw.connections))return false;}
 return true;
}
function snapshot(raw:unknown):WorkflowSnapshot{const value=object(raw);return {id:z.string().min(1).max(200).parse(value.id),active:'activeVersionId' in value?typeof value.activeVersionId==='string'&&value.activeVersionId.length>0:value.active===true,workflow:value};}
/** Official n8n API workflow list/create/get/activate. No hidden retry or origin
 * failover; API credentials remain server-only and response bodies never enter errors. */
export function createSequenceWorkflowProvider(options:{configuration:NativeN8nConfiguration;apiKey:string;fetch?:typeof fetch;beforeRequest:(step:string)=>Promise<void>}):SequenceWorkflowProvider{
 const request=options.fetch??fetch,url=safeUrl(options.configuration.url);z.string().min(1).parse(options.apiKey);
 async function api(path:string,method='GET',body?:unknown,signal:AbortSignal=AbortSignal.timeout(15000)){signal.throwIfAborted();await options.beforeRequest(method+':'+path);signal.throwIfAborted();const response=await request(url+'/api/v1'+path,{method,headers:{'X-N8N-API-KEY':options.apiKey,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),cache:'no-store',signal});if(!response.ok)throw new Error('Workflow provider request failed ('+response.status+').');return response.json();}
 const read=async(id:string,signal?:AbortSignal)=>{const value=snapshot(await api('/workflows/'+encodeURIComponent(id),'GET',undefined,signal));if(value.id!==id)throw new Error('Original workflow receipt ID changed');return value;};
 return {matches:workflowMatches,read,
  create:async workflow=>{const deadline=AbortSignal.timeout(15000),receipt=object(await api('/workflows','POST',workflow,deadline)),id=z.string().min(1).max(200).parse(receipt.id);return read(id,deadline);},
  activate:async(id,workflow)=>{const deadline=AbortSignal.timeout(15000),prior=await read(id,deadline);if(!workflowMatches(prior,workflow))throw new Error('Original workflow graph changed');if(!prior.active)await api('/workflows/'+encodeURIComponent(id)+'/activate','POST',undefined,deadline);return read(id,deadline);},
  find:async workflow=>{
   const name=z.string().min(1).parse(workflow.name),trigger=(workflow.nodes as unknown[]).map(object).find(node=>object(node.parameters).path&&node.webhookId),versionId=trigger?.webhookId;if(typeof versionId!=='string')throw new Error('Frozen workflow handle required');
   let cursor:string|undefined;const matches:WorkflowSnapshot[]=[],seen=new Set<string>(),deadline=AbortSignal.timeout(15000);
   for(let page=0;page<20;page++){
    const query=new URLSearchParams({name,limit:'100',excludePinnedData:'true',...(cursor?{cursor}:{})}),result=object(await api('/workflows?'+query.toString(),'GET',undefined,deadline));if(!Array.isArray(result.data))throw new Error('Invalid workflow search receipt');
    for(const item of result.data){const listed=object(item);if(listed.name!==name)continue;const original=await read(z.string().min(1).parse(listed.id),deadline);if(Array.isArray(original.workflow.nodes)&&original.workflow.nodes.map(object).some(node=>node.webhookId===versionId)){if(!workflowMatches(original,workflow))throw new Error('Original workflow graph changed');matches.push(original);}}
    if(!result.nextCursor){if(matches.length>1)throw new Error('Ambiguous original workflow');return matches[0]??null;}
    cursor=z.string().min(1).parse(result.nextCursor);if(seen.has(cursor))throw new Error('Repeated workflow cursor');seen.add(cursor);
   }throw new Error('Workflow reconciliation scan exceeded its bounded page limit');
  },
 };
}
