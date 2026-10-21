import {researchEnabled,researchServiceAuthorized} from '@/lib/research-service';
import {observeScheduledInitialResearch} from '@/lib/agent-initial-research-observer';
import {maintainScheduledResearch} from '@/lib/research-maintenance';
export const maxDuration=300;
export async function POST(request:Request){
 if(!researchEnabled()||!researchServiceAuthorized(request))return Response.json({error:'Not available'},{status:403});
 await observeScheduledInitialResearch();
 return Response.json({pending:await maintainScheduledResearch()});
}
