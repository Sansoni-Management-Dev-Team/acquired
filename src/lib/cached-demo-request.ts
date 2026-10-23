/** Demo creation is idempotent, but aborting the browser request cannot undo a
 * committed server operation. Reconcile only that original request after an
 * uncertain response; never automatically POST again or select another source. */
export const cachedDemoRequestTimeoutMs = 45_000;
type Saved = {id:string;revision?:string};
function saved(value:unknown):value is Saved {
 return Boolean(value&&typeof value==='object'&&'id'in value&&typeof value.id==='string'&&value.id);
}
export async function saveCachedDemoRequest(input:{native:boolean;body:string;sourceMandateId:string;onReconcile:()=>void},fetcher:typeof fetch=fetch):Promise<Saved>{
 let uncertain=false;
 try{
  const response=await fetcher(input.native?'/api/mandates/agent':'/api/mandates/demo-data',{method:'POST',headers:{'Content-Type':'application/json'},body:input.body,signal:AbortSignal.timeout(cachedDemoRequestTimeoutMs)});
  if(response.status>=500||response.status===408||response.status===429)uncertain=true;
  else{
   const value=await response.json();
   if(!response.ok)throw new DemoRequestRefused(typeof value?.error==='string'?value.error:'Could not open the saved demo. Retry the same request.');
   if(saved(value)&&(!input.native||typeof value.revision==='string'&&/^\d{1,30}$/.test(value.revision)))return value;
   uncertain=true;
  }
 }catch(error){if(error instanceof DemoRequestRefused)throw error;uncertain=true;}
 if(uncertain){
  input.onReconcile();
  const {requestId}=JSON.parse(input.body) as {requestId:string};
  const params=new URLSearchParams({requestId,sourceMandateId:input.sourceMandateId,presentation:input.native?'agent':'workspace'});
  for(let attempt=0;attempt<6;attempt++){
   if(attempt)await new Promise(resolve=>setTimeout(resolve,2000));
   try{
    const response=await fetcher('/api/mandates/demo-data?'+params,{cache:'no-store',signal:AbortSignal.timeout(5000)});
    if(response.status>=500||response.status===408||response.status===429)continue;
    if(!response.ok)break;
    const value=await response.json();
    if(value?.status==='ready'&&saved(value)&&value.id===requestId&&typeof value.revision==='string'&&/^\d{1,30}$/.test(value.revision))return value;
    if(value?.status!=='missing'&&value?.status!=='preparing')break;
   }catch{continue;}
  }
 }
 throw new Error('Could not confirm your demo yet. Retry opening it to check the same saved request.');
}
class DemoRequestRefused extends Error{}
