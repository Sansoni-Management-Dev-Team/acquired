import { auth } from "@/lib/auth";
import { CampaignError, saveCampaign } from "@/lib/campaign-service";
import { saveCampaignRequest } from "@/domain/campaign";
import { z } from "zod";

export async function PUT(request: Request, context: RouteContext<"/api/campaigns/[id]">) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.session.activeOrganizationId) return Response.json({ error: "Unauthorised" }, { status: 401 });
  const { id } = await context.params;
  const parsed = saveCampaignRequest.safeParse(await request.json().catch(() => null));
  if (!z.uuid().safeParse(id).success || !parsed.success) return Response.json({ error: "Invalid sequence" }, { status: 400 });
  try { return Response.json(await saveCampaign({ organizationId: session.session.activeOrganizationId, userId: session.user.id }, id, parsed.data.name, parsed.data.definition)); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Save failed" }, { status: error instanceof CampaignError ? error.status : 500 }); }
}
