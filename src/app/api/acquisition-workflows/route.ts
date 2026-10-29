import {z} from 'zod';
import {after} from 'next/server';
import {auth} from '@/lib/auth';
import {guardBrowserMutation} from '@/lib/browser-mutation';
import {agentPool} from '@/lib/agent-runtime';
import {acquisitionWorkflowEnabled,acquisitionWorkflowStartSchema,startAcquisitionWorkflow,readAcquisitionWorkflow,resumeAcquisitionWorkflow,AcquisitionWorkflowError} from '@/lib/acquisition-workflow';

const headers={'Cache-Control':'private, no-store'};
async function actor(request:Request){
 try{const session=await auth.api.getSession({headers:request.headers});return session?.session.activeOrganizationId?{organizationId:session.session.activeOrganizationId,userId:session.user.id}:undefined;}
 catch{return Response.json({error:'Sign-in status is temporarily unavailable. Please try again.'},{status:503,headers});}
}
function failure(error:unknown){return Response.json({error:error instanceof AcquisitionWorkflowError?error.message:'Could not confirm this workflow. Retry the same saved request.'},{status:error instanceof AcquisitionWorkflowError?error.status:503,headers});}
export async function POST(request:Request){
 const denied=guardBrowserMutation(request);if(denied)return denied;
 if(!acquisitionWorkflowEnabled())return Response.json({error:'Shared workflows are unavailable.'},{status:404,headers});
 const scoped=await actor(request);if(scoped instanceof Response)return scoped;if(!scoped)return Response.json({error:'Sign in and select an organisation.'},{status:401,headers});
 const text=await request.text();if(text.length>100000)return Response.json({error:'Workflow request is too large.'},{status:413,headers});
 let raw:unknown;try{raw=JSON.parse(text);}catch{return Response.json({error:'Invalid workflow request.'},{status:400,headers});}
 const parsed=acquisitionWorkflowStartSchema.safeParse(raw);if(!parsed.success)return Response.json({error:'Invalid workflow request.'},{status:400,headers});
 try{const pool=agentPool(),result=await startAcquisitionWorkflow(pool,scoped,parsed.data);after(async()=>{try{await resumeAcquisitionWorkflow(pool,scoped,result.id);}catch{console.info('workflow-resume-pending');}});return Response.json(result,{status:result.replayed?200:201,headers});}
 catch(error){return failure(error);}
}
export async function GET(request:Request){
 if(!acquisitionWorkflowEnabled()&&process.env.ACQUISITION_WORKFLOW_SCHEMA_READY!=='true')return Response.json({error:'Shared workflows are unavailable.'},{status:404,headers});
 const scoped=await actor(request);if(scoped instanceof Response)return scoped;if(!scoped)return Response.json({error:'Sign in and select an organisation.'},{status:401,headers});
 const params=new URL(request.url).searchParams;const parsed=z.object({requestId:z.string().uuid()}).strict().safeParse(Object.fromEntries(params));
 if(params.size!==1||!parsed.success)return Response.json({error:'Invalid workflow status request.'},{status:400,headers});
 try{const pool=agentPool(),result=await readAcquisitionWorkflow(pool,scoped,parsed.data.requestId);if(result&&['accepted','researching'].includes(result.state))after(async()=>{try{await resumeAcquisitionWorkflow(pool,scoped,result.id);}catch{console.info('workflow-resume-pending');}});return Response.json(result??{status:'missing'},{headers});}
 catch(error){return failure(error);}
}
