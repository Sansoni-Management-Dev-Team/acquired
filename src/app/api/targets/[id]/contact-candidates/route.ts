import { and, eq } from "drizzle-orm";
import { createTargetDataProvider } from "@/adapters/provider-mode";
import { targetSearchLog } from "@/adapters/live-target-search";
import { requireDb } from "@/db/client";
import { targets } from "@/db/schema";
import { auth } from "@/lib/auth";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "You must be signed in." }, { status: 401 });
  const organizationId = session.session.activeOrganizationId;
  if (!organizationId) return Response.json({ error: "Select an organisation first." }, { status: 403 });
  const { id } = await params;
  const [target] = await requireDb().select().from(targets).where(and(eq(targets.id, id), eq(targets.organizationId, organizationId))).limit(1);
  if (!target) return Response.json({ error: "Target not found." }, { status: 404 });
  const identifiers = target.identifiers as Record<string, unknown>;
  const firmableId = typeof identifiers.firmableId === "string" ? identifiers.firmableId : "";
  if (!firmableId) return Response.json({ error: "This target has no Firmable company ID." }, { status: 409 });

  try {
    const provider = createTargetDataProvider();
    if (provider.mode === "live" && !provider.firmable.isConfigured()) return Response.json({ error: "Firmable is not configured." }, { status: 503 });
    targetSearchLog("contact.candidates.request", { targetId: id, providerMode: provider.mode, firmableCompanyId: firmableId, maxCandidates: 5, searchPoolLimit: 50, strategy: "unfiltered_local_ranking" });
    let requestCount = 0;
    const candidates = await provider.firmable.searchDecisionMakers(firmableId, {
      max: 5,
      onAttempt: (attempt) => {
        requestCount += 1;
        targetSearchLog("contact.candidates.attempt", { targetId: id, requestNumber: requestCount, ...attempt });
      },
    });
    targetSearchLog("contact.candidates.complete", { targetId: id, requestCount, count: candidates.length, candidates: candidates.map(({ id: personId, position, seniority, department, emailAvailable, phoneAvailable }) => ({ personId, position, seniority, department, emailAvailable, phoneAvailable })) });
    return Response.json({ candidates });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Decision-maker search failed";
    targetSearchLog("contact.candidates.failed", { targetId: id, message });
    return Response.json({ error: message }, { status: 502 });
  }
}
