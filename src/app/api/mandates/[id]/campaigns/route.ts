import { auth } from "@/lib/auth";
import { createCampaign, listCampaignStudio, CampaignError } from "@/lib/campaign-service";
import { createCampaignRequest } from "@/domain/campaign";
import { z } from "zod";

async function actorFor(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.session.activeOrganizationId) return null;
  return { organizationId: session.session.activeOrganizationId, userId: session.user.id };
}

function failure(error: unknown) {
  return Response.json({ error: error instanceof Error ? error.message : "Campaign request failed" }, { status: error instanceof CampaignError ? error.status : 500 });
}

export async function GET(request: Request, context: RouteContext<"/api/mandates/[id]/campaigns">) {
  const actor = await actorFor(request);
  if (!actor) return Response.json({ error: "Unauthorised" }, { status: 401 });
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "Invalid mandate" }, { status: 400 });
  try { return Response.json(await listCampaignStudio(actor, id)); } catch (error) { return failure(error); }
}

export async function POST(request: Request, context: RouteContext<"/api/mandates/[id]/campaigns">) {
  const actor = await actorFor(request);
  if (!actor) return Response.json({ error: "Unauthorised" }, { status: 401 });
  const { id } = await context.params;
  const parsed = createCampaignRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success || parsed.data.mandateId !== id) return Response.json({ error: "Invalid sequence" }, { status: 400 });
  try { return Response.json(await createCampaign(actor, id, parsed.data.name, parsed.data.definition), { status: 201 }); } catch (error) { return failure(error); }
}
