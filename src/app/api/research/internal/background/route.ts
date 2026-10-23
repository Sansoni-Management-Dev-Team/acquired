import {researchEnabled,researchServiceAuthorized} from '@/lib/research-service';
import {scheduledResearchPass} from '@/lib/scheduled-research-pass';
export const maxDuration=300;
export async function POST(request:Request){
 if(!researchEnabled()||!researchServiceAuthorized(request))return Response.json({error:'Not available'},{status:403});
 try{
  return Response.json({pending:await scheduledResearchPass()});
 }catch{
  return Response.json({error:'Background research is temporarily unavailable',status:'unavailable'},
   {status:503,headers:{'Retry-After':'30'}});
 }
}
