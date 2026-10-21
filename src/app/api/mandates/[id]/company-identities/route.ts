import {z} from 'zod';
import {auth} from '@/lib/auth';
import {acquireCommands} from '@/lib/acquire-commands';
import {AcquireCommandError} from '@/domain/acquire-commands';
import {companyIdentityDecisionSchema} from '@/domain/company-identity-review';
import {guardBrowserMutation} from '@/lib/browser-mutation';

type Context={params:Promise<{id:string}>};
const headers={'Cache-Control':'private, no-store'};
const reconcileSchema=z.object({action:z.literal('reconcile_duplicates')}).strict();
const mutationSchema=z.union([companyIdentityDecisionSchema,reconcileSchema]);
const failure=(message:string,status:number)=>Response.json({error:message},{status,headers});
async function scope(request:Request,context:Context){
 const session=await auth.api.getSession({headers:request.headers});
 if(!session?.session.activeOrganizationId)return failure('Sign in and select an organisation.',401);
 const {id}=await context.params;
 if(!z.string().uuid().safeParse(id).success)return failure('Invalid mandate.',400);
 return {actor:{organizationId:session.session.activeOrganizationId,userId:session.user.id},mandateId:id};
}
function commandFailure(cause:unknown){
 if(cause instanceof AcquireCommandError)return failure(cause.message,cause.status);
 return failure('Company identity review could not be confirmed. Refresh the review before trying again.',503);
}

/** Both ordinary Companies and the agent's human review use these commands.
 * Research observations, candidates and authority are never supplied by chat. */
export async function GET(request:Request,context:Context){
 try{
  const current=await scope(request,context);if(current instanceof Response)return current;
  const result=await acquireCommands.execute(current.actor,{name:'company.identity.list',input:{mandateId:current.mandateId}});
  if(result.name!=='company.identity.list')throw Error('Unexpected company review result');
  return Response.json(result.value,{headers});
 }catch(cause){return commandFailure(cause);}
}
export async function POST(request:Request,context:Context){
 const denied=guardBrowserMutation(request);if(denied)return denied;
 const text=await request.text();if(text.length>4096)return failure('Company identity decision is too large.',413);
 let raw:unknown;try{raw=JSON.parse(text);}catch{return failure('Invalid company identity decision.',400);}
 const parsed=mutationSchema.safeParse(raw);if(!parsed.success)return failure('Invalid company identity decision.',400);
 try{
  const current=await scope(request,context);if(current instanceof Response)return current;
  if('action' in parsed.data){
   const result=await acquireCommands.execute(current.actor,{name:'company.identity.reconcile',input:{mandateId:current.mandateId}});
   if(result.name!=='company.identity.reconcile')throw Error('Unexpected company consolidation result');
   return Response.json(result.value,{headers});
  }
  const result=await acquireCommands.execute(current.actor,{name:'company.identity.decide',input:{mandateId:current.mandateId,decision:parsed.data}});
  if(result.name!=='company.identity.decide')throw Error('Unexpected company review result');
  return Response.json({decision:result.value},{headers});
 }catch(cause){return commandFailure(cause);}
}
