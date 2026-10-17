import {z} from 'zod';
import {auth} from '@/lib/auth';
import {agentStore,durableAgentEnabled} from '@/lib/agent-runtime';
import {acquireCommands} from '@/lib/acquire-commands';
import {AcquireCommandError} from '@/domain/acquire-commands';
export type AgentRequestContext={params:Promise<{id:string}>};
export const agentResponseHeaders={'Cache-Control':'private, no-store'};
export const agentRequestError=(message:string,status:number)=>Response.json({error:message},{status,headers:agentResponseHeaders});
export async function agentRequestScope(request:Request,context:AgentRequestContext){
 if(process.env.AGENT_MODE_EXPLORATION_ENABLED!=='true'||!durableAgentEnabled())return agentRequestError('Agent controls are unavailable.',404);
 const session=await auth.api.getSession({headers:request.headers});
 if(!session?.session.activeOrganizationId)return agentRequestError('Sign in and select an organisation.',401);
 const {id}=await context.params;if(!z.string().uuid().safeParse(id).success)return agentRequestError('Invalid mandate.',400);
 const actor={organizationId:session.session.activeOrganizationId,userId:session.user.id};
 const result=await acquireCommands.execute(actor,{name:'mandate.read',input:{mandateId:id}});
 const store=agentStore(actor),thread=await store.findThread(id);
 return {actor,store,thread,mandate:result.name==='mandate.read'?result.value:undefined};
}
export function agentRequestFailure(cause:unknown){
 if(cause instanceof AcquireCommandError)return agentRequestError(cause.message,cause.status);
 return agentRequestError('This item changed or is unavailable. Refresh before trying again.',409);
}
