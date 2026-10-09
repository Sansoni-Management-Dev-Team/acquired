import { auth } from "@/lib/auth";
import { listCampaignReplyAlerts } from "@/lib/campaign-reply-alerts";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.session.activeOrganizationId) return Response.json({ error: "Unauthorised" }, { status: 401 });
  const actor = { organizationId: session.session.activeOrganizationId, userId: session.user.id };
  try {
    return Response.json({ scope: JSON.stringify([actor.organizationId, actor.userId]), alerts: await listCampaignReplyAlerts(actor) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ error: "Reply alerts unavailable" }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
