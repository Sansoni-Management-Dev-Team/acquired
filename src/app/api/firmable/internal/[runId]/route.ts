import { z } from "zod";
import { researchEnabled, researchServiceAuthorized } from "@/lib/research-service";
import {
  completeFirmableRefresh,
  failFirmableRefresh,
  finalizeFirmablePeopleSearch,
  refreshFirmableCompany,
  refreshFirmablePeoplePage,
  refreshFirmableProfileBatch,
} from "@/lib/firmable-refresh";
import { FirmableHistoryRepository } from "@/db/firmable-history-repository";

export const maxDuration = 60;

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("company"), mandateId: z.string().uuid() }),
  z.object({ action: z.literal("people-page"), offset: z.number().int().min(0).max(9_900) }),
  z.object({ action: z.literal("finalize-search"), offset: z.number().int().min(0).max(9_999) }),
  z.object({ action: z.literal("profiles"), offset: z.number().int().min(0).max(9_999) }),
  z.object({ action: z.literal("complete"), mandateId: z.string().uuid() }),
  z.object({ action: z.literal("fail"), message: z.string().trim().min(1).max(500) }),
]);

async function authorizedRun(request: Request, runId: string) {
  if (!researchServiceAuthorized(request) || !researchEnabled() || !z.string().uuid().safeParse(runId).success) return undefined;
  return new FirmableHistoryRepository().run(runId);
}

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  const run = await authorizedRun(request, runId);
  if (!run) return Response.json({ error: "Not available" }, { status: 403 });
  return Response.json({ id: run.id, status: run.status, updatedAt: run.updatedAt.toISOString() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  if (!await authorizedRun(request, runId)) return Response.json({ error: "Not available" }, { status: 403 });
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid Firmable workflow action" }, { status: 400 });
  const action = parsed.data;
  if (action.action === "company") return Response.json(await refreshFirmableCompany(runId, action.mandateId));
  if (action.action === "people-page") return Response.json(await refreshFirmablePeoplePage(runId, action.offset));
  if (action.action === "finalize-search") return Response.json(await finalizeFirmablePeopleSearch(runId, action.offset));
  if (action.action === "profiles") return Response.json(await refreshFirmableProfileBatch(runId, action.offset));
  if (action.action === "complete") return Response.json(await completeFirmableRefresh(runId, action.mandateId));
  await failFirmableRefresh(runId, action.message);
  return Response.json({ ok: true });
}
