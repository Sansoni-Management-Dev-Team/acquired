import { auth } from "@/lib/auth";
import { CampaignError, publishCampaign } from "@/lib/campaign-service";
import { z } from "zod";

export async function POST(request: Request, context: RouteContext<"/api/campaigns/[id]/publish">) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.session.activeOrganizationId) return Response.json({ error: "Unauthorised" }, { status: 401 });
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "Invalid sequence" }, { status: 400 });
  try { return Response.json(await publishCampaign({ organizationId: session.session.activeOrganizationId, userId: session.user.id }, id)); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Publish failed" }, { status: error instanceof CampaignError ? error.status : 500 }); }
}
