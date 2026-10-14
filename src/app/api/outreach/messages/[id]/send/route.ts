import {auth} from '@/lib/auth';
import {hasTrustedRequestOrigin} from '@/lib/request-origin';
import {sendSavedOutreachDraft} from '@/lib/outreach-draft-send';
import {ReplyCheckPending,ReplyCheckReview} from '@/lib/campaign-reply-status';
export const runtime='nodejs';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 const session=await auth.api.getSession({headers:request.headers});if(!session)return Response.json({error:'Sign in to send a saved draft'},{status:401});
 const organizationId=session.session.activeOrganizationId;if(!organizationId)return Response.json({error:'Choose an organisation'},{status:403});
 if(!hasTrustedRequestOrigin(request))return Response.json({error:'Invalid origin'},{status:403});
 if(process.env.COMMUNICATIONS_RUNTIME_ENABLED!=='true')return Response.json({error:'Draft sending unavailable'},{status:503});
 const {id}=await params;if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))return Response.json({error:'Invalid draft'},{status:400});
 try{return Response.json(await sendSavedOutreachDraft({organizationId,userId:session.user.id},id),{headers:{'Cache-Control':'no-store'}});}catch(error){
  if(error instanceof ReplyCheckPending)return Response.json({status:'waiting',code:error.code,retryAt:error.retryAt.toISOString()},{status:409});
  if(error instanceof ReplyCheckReview)return Response.json({status:'review',code:error.code},{status:409});
  return Response.json({error:'Saved draft sending unavailable'},{status:503});
 }
}
