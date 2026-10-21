import {auth} from '@/lib/auth';
import {guardBrowserMutation} from '@/lib/browser-mutation';
import {agentPool} from '@/lib/agent-runtime';
import {selectCachedDemoResearch} from '@/lib/cached-demo-research';
import {createCachedDemo,cachedDemoCreateSchema} from '@/lib/create-cached-demo';
import {NativeMandateCreateError} from '@/lib/agent-native-create';
const headers={'Cache-Control':'private, no-store'};
async function actor(request:Request){const session=await auth.api.getSession({headers:request.headers});return session?.session.activeOrganizationId?{organizationId:session.session.activeOrganizationId,userId:session.user.id}:undefined;}
export async function GET(request:Request){
 const scoped=await actor(request);if(!scoped)return Response.json({error:'Sign in and select an organisation.'},{status:401,headers});
 try{const selected=await selectCachedDemoResearch(agentPool(),scoped);if(!selected)return Response.json({error:'No saved company and people dataset is available for a demo yet. No live research was started.'},{status:409,headers});return Response.json({sourceMandateId:selected.sourceMandateId,brief:selected.brief,companies:selected.companyCount,people:selected.peopleCount},{headers});}
 catch{return Response.json({error:'Saved demo data is temporarily unavailable. No live research was started.'},{status:503,headers});}
}
export async function POST(request:Request){
 const denied=guardBrowserMutation(request);if(denied)return denied;
 const scoped=await actor(request);if(!scoped)return Response.json({error:'Sign in and select an organisation.'},{status:401,headers});
 const text=await request.text();if(text.length>2000)return Response.json({error:'Demo request is too large.'},{status:413,headers});
 let raw:unknown;try{raw=JSON.parse(text);}catch{return Response.json({error:'Invalid demo request.'},{status:400,headers});}
 const parsed=cachedDemoCreateSchema.safeParse(raw);if(!parsed.success)return Response.json({error:'Invalid saved-data demo request.'},{status:400,headers});
 try{const result=await createCachedDemo(agentPool(),scoped,parsed.data,'workspace');return Response.json(result,{status:result.replayed?200:201,headers});}
 catch(error){return Response.json({error:error instanceof NativeMandateCreateError?error.message:'Could not load the saved demo. Retry the same request; no live research was started.'},{status:error instanceof NativeMandateCreateError?error.status:503,headers});}
}
