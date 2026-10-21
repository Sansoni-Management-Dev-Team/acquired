export type WorkflowSnapshot={id:string;active:boolean;workflow:Record<string,unknown>};
export type PublicationEffect={state:'running'|'uncertain'|'complete';workflowId?:string};
export type SequencePublicationState={complete:boolean;result?:unknown;workflow:Record<string,unknown>|null;create:PublicationEffect|null;activate:PublicationEffect|null};
export interface SequencePublicationPort{
 load():Promise<SequencePublicationState>;assertCurrent(step:string):Promise<void>;claim(phase:'create'|'activate'):Promise<boolean>;record(phase:'create'|'activate',result:PublicationEffect):Promise<void>;commit(workflowId:string|null):Promise<unknown>;
}
export interface SequenceWorkflowProvider{
 create(workflow:Record<string,unknown>):Promise<WorkflowSnapshot>;find(workflow:Record<string,unknown>):Promise<WorkflowSnapshot|null>;read(id:string):Promise<WorkflowSnapshot>;activate(id:string,workflow:Record<string,unknown>):Promise<WorkflowSnapshot>;matches(actual:WorkflowSnapshot,expected:Record<string,unknown>):boolean;
}
/** Every write is preceded by a durable single-attempt claim. Unknown provider
 * outcomes are resolved by positive reads of the original frozen graph; absence
 * is not proof that creation or activation was never accepted. */
export async function runAgentSequencePublication(port:SequencePublicationPort,provider:SequenceWorkflowProvider){
 const review=(reason:string)=>({kind:'review' as const,reason});
 for(let step=0;step<4;step++){
  const state=await port.load();if(state.complete)return {kind:'complete' as const,result:state.result};
  await port.assertCurrent('publication:'+step);
  if(!state.workflow)return {kind:'complete' as const,result:await port.commit(null)};
  if(state.create?.state!=='complete'){
   let snapshot:WorkflowSnapshot|null=null;
   try{
    if(!state.create&&await port.claim('create')){await port.assertCurrent('workflow-create');snapshot=await provider.create(state.workflow);}
    else snapshot=state.create?.workflowId?await provider.read(state.create.workflowId):await provider.find(state.workflow);
    if(!snapshot||state.create?.workflowId&&snapshot.id!==state.create.workflowId||!provider.matches(snapshot,state.workflow))return review('Original workflow creation needs positive receipt reconciliation. No replacement was created.');
    await port.record('create',{state:'complete',workflowId:snapshot.id});
   }catch{await port.record('create',{state:'uncertain',...(snapshot?{workflowId:snapshot.id}:{})}).catch(()=>{});return review('Workflow creation is uncertain. Reconcile the original attempt before continuing.');}
   continue;
  }
  const workflowId=state.create.workflowId;if(!workflowId)return review('Created workflow receipt is incomplete.');
  if(state.activate?.state!=='complete'){
   try{
    const original=!state.activate&&await port.claim('activate')?(await port.assertCurrent('workflow-activate'),await provider.activate(workflowId,state.workflow)):await provider.read(workflowId);
    if(original.id!==workflowId||!original.active||!provider.matches(original,state.workflow))return review('Original workflow activation needs a verified active matching graph. No activation retry was started.');
    await port.record('activate',{state:'complete',workflowId});
   }catch{await port.record('activate',{state:'uncertain',workflowId}).catch(()=>{});return review('Workflow activation is uncertain. Read the original workflow before retrying any action.');}
   continue;
  }
  if(state.activate.workflowId!==workflowId)return review('Workflow receipts disagree.');
  // Fresh positive evidence is required immediately before the database pin.
  const original=await provider.read(workflowId);if(original.id!==workflowId||!original.active||!provider.matches(original,state.workflow))return review('The original active workflow receipt changed before publication.');
  return {kind:'complete' as const,result:await port.commit(workflowId)};
 }
 return review('Publication reached its bounded step limit.');
}
