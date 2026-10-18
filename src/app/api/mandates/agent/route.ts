import {auth} from '@/lib/auth';
import {guardBrowserMutation} from '@/lib/browser-mutation';
import {nativeAgentEnabled,agentPool} from '@/lib/agent-runtime';
import {createNativeAgentMandate,nativeMandateCreateSchema,NativeMandateCreateError} from '@/lib/agent-native-create';
const headers={'Cache-Control':'private, no-store'};
export async function POST(request:Request){
 const denied=guardBrowserMutation(request);if(denied)return denied;
 if(!nativeAgentEnabled())return Response.json({error:'Native agent creation is unavailable.'},{status:404,headers});
 const session=await auth.api.getSession({headers:request.headers});if(!session?.session.activeOrganizationId)return Response.json({error:'Sign in and select an organisation.'},{status:401,headers});
 const text=await request.text();if(text.length>100000)return Response.json({error:'Reviewed mandate is too large.'},{status:413,headers});
 let value:unknown;try{value=JSON.parse(text);}catch{return Response.json({error:'Invalid mandate request.'},{status:400,headers});}
 const parsed=nativeMandateCreateSchema.safeParse(value);if(!parsed.success)return Response.json({error:'Invalid reviewed mandate.'},{status:400,headers});
 try{const result=await createNativeAgentMandate(agentPool(),{organizationId:session.session.activeOrganizationId,userId:session.user.id},parsed.data);return Response.json(result,{status:result.replayed?200:201,headers});}
 catch(error){return Response.json({error:error instanceof NativeMandateCreateError?error.message:'Could not confirm mandate creation. Retry the same request to reconcile it.'},{status:error instanceof NativeMandateCreateError?error.status:503,headers});}
}
