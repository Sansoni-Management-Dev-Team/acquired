import {auth} from '@/lib/auth';
import {guardBrowserMutation} from '@/lib/browser-mutation';
import {nativeAgentEnabled,agentPool} from '@/lib/agent-runtime';
import {createNativeAgentMandate,nativeMandateCreateSchema,NativeMandateCreateError} from '@/lib/agent-native-create';
import {ensureInitialMandateResearch} from '@/lib/agent-initial-research';
import {createCachedDemo} from '@/lib/create-cached-demo';
import {traceOperation} from '../../../../../communications/packages/core/src/operation-trace';
const headers={'Cache-Control':'private, no-store'};
export async function POST(request:Request){
 const denied=guardBrowserMutation(request);if(denied)return denied;
 if(!nativeAgentEnabled())return Response.json({error:'Native agent creation is unavailable.'},{status:404,headers});
 const session=await auth.api.getSession({headers:request.headers}).catch(()=>Response.json({error:'Sign-in status is temporarily unavailable. Please try again.'},{status:503,headers}));if(session instanceof Response)return session;if(!session?.session.activeOrganizationId)return Response.json({error:'Sign in and select an organisation.'},{status:401,headers});
 const text=await request.text();if(text.length>100000)return Response.json({error:'Reviewed mandate is too large.'},{status:413,headers});
 let value:unknown;try{value=JSON.parse(text);}catch{return Response.json({error:'Invalid mandate request.'},{status:400,headers});}
 const parsed=nativeMandateCreateSchema.safeParse(value);if(!parsed.success)return Response.json({error:'Invalid reviewed mandate.'},{status:400,headers});
 try{const actor={organizationId:session.session.activeOrganizationId,userId:session.user.id},pool=agentPool();
  if(parsed.data.executionMode==='demo'){
   const result=await traceOperation('acquire.demo.create',{kind:'span',requestId:parsed.data.requestId},()=>createCachedDemo(pool,actor,{requestId:parsed.data.requestId,...(parsed.data.demoSourceMandateId?{sourceMandateId:parsed.data.demoSourceMandateId}:{})},'agent'));
   return Response.json(result,{status:result.replayed?200:201,headers});
  }
  const result=await createNativeAgentMandate(pool,actor,parsed.data,{startResearch:true,startOn:'chat'});
  let initialResearch;
  if(result.initialResearch){
   try{initialResearch=await ensureInitialMandateResearch(pool,actor,result.id);}
   catch{initialResearch={requestId:result.id,status:'queued'};console.info('agent-initial-research',JSON.stringify({module:'agent-initial-research',stage:'submission_saved_launch_pending',mandateId:result.id,timestamp:new Date().toISOString()}));}
  }
  return Response.json({...result,...(initialResearch?{initialResearch}:{})},{status:result.replayed?200:201,headers});}
 catch(error){return Response.json({error:error instanceof NativeMandateCreateError?error.message:'Could not confirm mandate creation. Retry the same request to reconcile it.'},{status:error instanceof NativeMandateCreateError?error.status:503,headers});}
}
