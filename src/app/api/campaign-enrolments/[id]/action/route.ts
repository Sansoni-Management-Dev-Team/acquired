import { auth } from "@/lib/auth";
import { CampaignError, changeEnrolment } from "@/lib/campaign-service";
import { enrolmentActionRequest } from "@/domain/campaign";
import { z } from "zod";

export async function POST(request: Request, context: RouteContext<"/api/campaign-enrolments/[id]/action">) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.session.activeOrganizationId) return Response.json({ error: "Unauthorised" }, { status: 401 });
  const { id } = await context.params;
  const parsed = enrolmentActionRequest.safeParse(await request.json().catch(() => null));
  if (!z.uuid().safeParse(id).success || !parsed.success) return Response.json({ error: "Invalid action" }, { status: 400 });
  try { return Response.json(await changeEnrolment({ organizationId: session.session.activeOrganizationId, userId: session.user.id }, id, parsed.data.action)); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Action failed" }, { status: error instanceof CampaignError ? error.status : 500 }); }
}
