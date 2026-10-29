import {createMandateGenerationRequests,MandateGenerationRequestError} from '@/lib/mandate-generation-requests';
import { auth } from "@/lib/auth";
import { generateMandate } from "@/adapters/mandate-generation";
import { z } from "zod";

export const maxDuration = 60;
const generationRequests=createMandateGenerationRequests();

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.session.activeOrganizationId) return Response.json({ error: "Sign in and select an organisation." }, { status: 401 });
  const input = z.object({ description: z.string().trim().min(10).max(5000), requestId:z.string().uuid().optional() }).safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ error: "Describe the businesses you're looking to buy." }, { status: 400 });
  try {
    const {description,requestId}=input.data;
    if(requestId&&!session.user?.id)return Response.json({error:'Sign in and select an organisation.'},{status:401});
    const brief=requestId?await generationRequests.run({organizationId:session.session.activeOrganizationId,userId:session.user.id,requestId,description},()=>generateMandate(description)):await generateMandate(description);
    return Response.json({brief});
  } catch(error) {
    if(error instanceof MandateGenerationRequestError)return Response.json({error:error.message},{status:error.status});
    return Response.json({ error: "Brief generation is temporarily unavailable. Please try again shortly or enter your brief manually." }, { status: 503 });
  }
}
