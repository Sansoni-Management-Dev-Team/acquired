import {auth} from '@/lib/auth';
import {guardBrowserMutation} from '@/lib/browser-mutation';
import {agentPool} from '@/lib/agent-runtime';
import {selectCachedDemoResearch} from '@/lib/cached-demo-research';
import {createCachedDemo,cachedDemoCreateSchema} from '@/lib/create-cached-demo';
import {NativeMandateCreateError} from '@/lib/agent-native-create';
import {cachedDemoStatusQuerySchema,readCachedDemoStatus} from '@/lib/cached-demo-status';
import {traceOperation} from '../../../../../communications/packages/core/src/operation-trace';
const headers={'Cache-Control':'private, no-store'};
async function actor(request:Request){try{const session=await auth.api.getSession({headers:request.headers});return session?.session.activeOrganizationId?{organizationId:session.session.activeOrganizationId,userId:session.user.id}:undefined;}catch{return Response.json({error:'Sign-in status is temporarily unavailable. Please try again.'},{status:503,headers});}}
export async function GET(request:Request){
 const scoped=await actor(request);if(scoped instanceof Response)return scoped;if(!scoped)return Response.json({error:'Sign in and select an organisation.'},{status:401,headers});
 const params=new URL(request.url).searchParams;
 if(params.size){
  const parsed=cachedDemoStatusQuerySchema.safeParse(Object.fromEntries(params));
  if(!parsed.success||params.size!==3)return Response.json({error:'Invalid demo status request.'},{status:400,headers});
  try{return Response.json(await traceOperation('acquire.demo.status',{kind:'span',requestId:parsed.data.requestId},()=>readCachedDemoStatus(agentPool(),scoped,parsed.data)),{headers});}
  catch{return Response.json({error:'Could not check the saved demo. Retry the same request.'},{status:503,headers});}
 }
 try{const selected=await traceOperation('acquire.demo.source.select',{kind:'span'},()=>selectCachedDemoResearch(agentPool(),scoped));if(!selected)return Response.json({error:'No saved company and people dataset is available for a demo yet. No live research was started.'},{status:409,headers});return Response.json({sourceMandateId:selected.sourceMandateId,brief:selected.brief,companies:selected.companyCount,people:selected.peopleCount},{headers});}
 catch{return Response.json({error:'Saved demo data is temporarily unavailable. No live research was started.'},{status:503,headers});}
}
export async function POST(request:Request){
 const denied=guardBrowserMutation(request);if(denied)return denied;
 const scoped=await actor(request);if(scoped instanceof Response)return scoped;if(!scoped)return Response.json({error:'Sign in and select an organisation.'},{status:401,headers});
 const text=await request.text();if(text.length>2000)return Response.json({error:'Demo request is too large.'},{status:413,headers});
 let raw:unknown;try{raw=JSON.parse(text);}catch{return Response.json({error:'Invalid demo request.'},{status:400,headers});}
 const parsed=cachedDemoCreateSchema.safeParse(raw);if(!parsed.success)return Response.json({error:'Invalid saved-data demo request.'},{status:400,headers});
 try{const result=await traceOperation('acquire.demo.create',{kind:'span',requestId:parsed.data.requestId},()=>createCachedDemo(agentPool(),scoped,parsed.data,'workspace'));return Response.json(result,{status:result.replayed?200:201,headers});}
 catch(error){return Response.json({error:error instanceof NativeMandateCreateError?error.message:'Could not load the saved demo. Retry the same request; no live research was started.'},{status:error instanceof NativeMandateCreateError?error.status:503,headers});}
}
