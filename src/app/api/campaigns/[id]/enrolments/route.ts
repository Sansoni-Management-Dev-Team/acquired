import { auth } from "@/lib/auth";
import { CampaignError, enrolContacts } from "@/lib/campaign-service";
import { enrolCampaignRequest } from "@/domain/campaign";
import { z } from "zod";

export async function POST(request: Request, context: RouteContext<"/api/campaigns/[id]/enrolments">) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.session.activeOrganizationId) return Response.json({ error: "Unauthorised" }, { status: 401 });
  const { id } = await context.params;
  const parsed = enrolCampaignRequest.safeParse(await request.json().catch(() => null));
  if (!z.uuid().safeParse(id).success || !parsed.success) return Response.json({ error: "Confirm the automation and select valid contacts" }, { status: 400 });
  try { return Response.json({ enrolments: await enrolContacts({ organizationId: session.session.activeOrganizationId, userId: session.user.id }, id, parsed.data.contactIds) }, { status: 201 }); }
  catch (error) { return Response.json({ error: (error as { code?: string })?.code === "23505" ? "This contact already has active outreach" : error instanceof Error ? error.message : "Enrolment failed" }, { status: error instanceof CampaignError ? error.status : (error as { code?: string })?.code === "23505" ? 409 : 500 }); }
}
