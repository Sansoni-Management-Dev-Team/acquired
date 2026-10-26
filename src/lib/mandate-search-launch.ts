import {z} from 'zod';
import {briefSchema} from '@/domain/acquisition';
import {readJsonResponse} from './read-json-response';
import {pendingWorkflowIdentity,saveAcquisitionWorkflowRequest,savedWorkflowSchema,workflowPendingStorageKey,type SavedWorkflow} from './acquisition-workflow-request';

const uuid=z.string().uuid();
const launchSchema=z.object({version:z.literal(1),requestId:uuid,preset:z.enum(['live','live-research-test']),presentation:z.enum(['agent','workspace']),description:z.string().trim().min(10).max(5000).optional(),requestBody:z.string().max(100000).optional()}).strict().refine(v=>Boolean(v.description||v.requestBody));
export type MandateSearchLaunch=z.infer<typeof launchSchema>;
type StoragePort=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
const fallback=new Map<string,string>();
const fallbackStorage:StoragePort={getItem:key=>fallback.get(key)??null,setItem:(key,value)=>{fallback.set(key,value);},removeItem:key=>{fallback.delete(key);}};
function browserStorage():StoragePort{try{return sessionStorage;}catch{return fallbackStorage;}}
const memory=new WeakMap<StoragePort,Map<string,MandateSearchLaunch>>();
const running=new WeakMap<StoragePort,Map<string,Promise<SavedWorkflow|null>>>();
const key=(id:string)=>`acquire.pending-search.v1:${uuid.parse(id)}`;
export const mandateSearchHref=(id:string)=>`/mandates/${encodeURIComponent(id)}?tab=search+enrich`;
function remembered(storage:StoragePort){let entries=memory.get(storage);if(!entries){entries=new Map();memory.set(storage,entries);}return entries;}
export function readMandateSearch(id:string,storage:StoragePort=browserStorage()):MandateSearchLaunch|undefined{
 try{const raw=storage.getItem(key(id));if(raw){const parsed=launchSchema.safeParse(JSON.parse(raw));if(parsed.success&&parsed.data.requestId===id)return parsed.data;}}
 catch{/* An in-memory draft still survives client navigation when storage is unavailable. */}
 return remembered(storage).get(id);
}
function persist(launch:MandateSearchLaunch,storage:StoragePort,initial=false){
 remembered(storage).set(launch.requestId,launch);
 try{
  storage.setItem(key(launch.requestId),JSON.stringify(launch));
  const pending=pendingWorkflowIdentity(storage.getItem(workflowPendingStorageKey)??'');
  if(initial||pending?.requestId===launch.requestId)storage.setItem(workflowPendingStorageKey,launch.requestBody??JSON.stringify({requestId:launch.requestId,preset:launch.preset,presentation:launch.presentation}));
 }catch{/* Keep the same draft in memory, never make up another request identity. */}
}
export function stageMandateSearch(input:Omit<MandateSearchLaunch,'version'>,storage:StoragePort=browserStorage()):MandateSearchLaunch{
 const value=launchSchema.parse({version:1,...input}),prior=readMandateSearch(value.requestId,storage);
 if(prior){if(prior.preset!==value.preset||prior.presentation!==value.presentation)throw Error('This saved search has a different mode.');persist(prior,storage,true);return prior;}
 persist(value,storage,true);return value;
}
function clear(launchId:string,storage:StoragePort){
 remembered(storage).delete(launchId);
 try{storage.removeItem(key(launchId));if(pendingWorkflowIdentity(storage.getItem(workflowPendingStorageKey)??'')?.requestId===launchId)storage.removeItem(workflowPendingStorageKey);}catch{/* The saved receipt remains the authority after admission. */}
}
/** One browser operation per identity. A refresh first checks the owned receipt;
 * a generated body is persisted before admission and is never regenerated on retry. */
export function continueMandateSearch(id:string,storage:StoragePort=browserStorage(),fetcher:typeof fetch=fetch):Promise<SavedWorkflow|null>{
 uuid.parse(id);let requests=running.get(storage);if(!requests){requests=new Map();running.set(storage,requests);}const previous=requests.get(id);if(previous)return previous;
 const pending=run(id,storage,fetcher).finally(()=>{requests!.delete(id);});requests.set(id,pending);return pending;
}
async function run(id:string,storage:StoragePort,fetcher:typeof fetch):Promise<SavedWorkflow|null>{
 let launch=readMandateSearch(id,storage);
 const receipt=await fetcher('/api/acquisition-workflows?'+new URLSearchParams({requestId:id}),{cache:'no-store',signal:AbortSignal.timeout(15000)});
 if(!receipt.ok)throw Error('Could not check this search. Retry to check the same saved request.');
 const rawReceipt=await readJsonResponse(receipt,'Could not read this saved search.');
 if(rawReceipt.status!=='missing'){
  const parsed=savedWorkflowSchema.safeParse(rawReceipt);
  if(!parsed.success||parsed.data.id!==id||parsed.data.mandateId!==id||launch&&(parsed.data.preset!==launch.preset||parsed.data.presentation!==launch.presentation))throw Error('This saved search has a different identity or mode.');
  clear(id,storage);return parsed.data;
 }
 if(!launch)return null; // Existing legacy mandate / shared link: read progress, never launch guessed work.
 if(!launch.requestBody){
  const response=await fetcher('/api/mandates/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({description:launch.description,requestId:id}),signal:AbortSignal.timeout(60000)});
  const raw=await readJsonResponse(response,'Could not prepare this mandate. Retry the same search.'),brief=briefSchema.safeParse(raw.brief);
  if(!response.ok||!brief.success)throw Error(typeof raw.error==='string'?raw.error:'Could not prepare this mandate.');
  launch={...launch,requestBody:JSON.stringify({requestId:id,preset:launch.preset,presentation:launch.presentation,brief:brief.data})};persist(launch,storage);
 }
 const requestBody=launch.requestBody;if(!requestBody)throw Error('The original search body is unavailable.');
 const identity=pendingWorkflowIdentity(requestBody);
 if(identity?.requestId!==id||identity.preset!==launch.preset||identity.presentation!==launch.presentation)throw Error('The original saved search changed. Return to the brief before trying again.');
 const saved=await saveAcquisitionWorkflowRequest(requestBody,fetcher);
 if(saved.mandateId!==id)throw Error('The saved mandate identity does not match this search.');
 clear(id,storage);return saved;
}
