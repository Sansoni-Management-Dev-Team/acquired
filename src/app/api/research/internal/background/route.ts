import {researchEnabled,researchServiceAuthorized} from '@/lib/research-service';
import {recoverCompanyBackground} from '@/lib/company-background-dispatch';
export const maxDuration=300;
export async function POST(request:Request){
 if(!researchEnabled()||!researchServiceAuthorized(request))return Response.json({error:'Not available'},{status:403});
 return Response.json({pending:await recoverCompanyBackground()});
}
