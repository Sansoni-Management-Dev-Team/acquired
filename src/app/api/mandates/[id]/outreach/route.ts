import { z } from "zod";
import { auth } from "@/lib/auth";
import { AcquisitionRepository } from "@/db/acquisition-repository";
import { loadOutreach } from "@/db/outreach-view";
import { requireDb } from "@/db/client";
import { FirmableHistoryRepository } from "@/db/firmable-history-repository";
import { recoverFirmableRefreshes } from "@/lib/firmable-run-recovery";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  const org = session?.session.activeOrganizationId;
  if (!org) return Response.json({ error: "Sign in first" }, { status: 401 });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return Response.json({ error: "Invalid mandate" }, { status: 400 });
  const mandate = await new AcquisitionRepository(org).getMandate(id);
  if (!mandate) return Response.json({ error: "Mandate not found" }, { status: 404 });
  const targetId = new URL(request.url).searchParams.get('targetId') || undefined;
  if (targetId && !z.uuid().safeParse(targetId).success) return Response.json({ error: 'Invalid company' }, { status: 400 });
  const history = new FirmableHistoryRepository(requireDb());
  let runs = targetId ? await history.latestRuns(org, [targetId]) : [];
  if (runs.some(run => ["queued", "running"].includes(run.status))) {
    await recoverFirmableRefreshes(history, runs, id);
    runs = await history.latestRuns(org, [targetId!]);
  }
  return Response.json({ ...await loadOutreach(org, id, session.user.id, targetId), peopleRun: runs[0] }, { headers: { "Cache-Control": "no-store" } });
}
