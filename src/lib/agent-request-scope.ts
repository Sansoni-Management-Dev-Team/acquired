import {types} from 'node:util';
import {z} from 'zod';
import {safeResearchFailure} from '@/domain/research-trace-context';
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
/** Exact static guard messages map to bounded diagnostics only. Never log the
 * original text, payload, recipient, stack or arbitrary error properties. */
const reviewFailures:Readonly<Record<string,string>>={
 'Conversation changed; review its current state first':'conversation_context_changed',
 'Only an active agent conversation or a human-review agent hold can be reviewed':'conversation_not_reviewable',
 'Review and start the current mandate responsibility first':'responsibility_not_current',
 'Finish the current person or mandate background work before reviewing':'background_work_active',
 'Resolve current unknown outcomes, ownership, suppression or channel review before reassessment':'review_blocked',
 'Refresh complete recorded history before requesting reassessment':'history_not_current',
};
export function agentRequestFailure(cause:unknown){
 if(cause instanceof AcquireCommandError)return agentRequestError(cause.message,cause.status);
 const message=cause&&typeof cause==='object'&&!types.isProxy(cause)?Object.getOwnPropertyDescriptor(cause,'message')?.value:undefined;
 const reviewFailure=typeof message==='string'&&Object.hasOwn(reviewFailures,message)?reviewFailures[message]:undefined;
 console.warn('agent-request-failed',{...safeResearchFailure(cause),...(reviewFailure?{reviewFailure}:{})});
 return agentRequestError('This item changed or is unavailable. Refresh before trying again.',409);
}
