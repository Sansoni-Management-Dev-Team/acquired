import { observeResearchRequest, researchRequestJson, researchJsonResponse, setResearchDatabaseContext } from '@/lib/research-request-observability';
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
import { FirmableError } from "@/adapters/firmable-client";

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

async function getControl(request: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  const run = await authorizedRun(request, runId);
  if (!run) return researchJsonResponse({ error: "Not available" }, { status: 403 });
  return researchJsonResponse({ id: run.id, status: run.status, updatedAt: run.updatedAt.toISOString() }, { headers: { "Cache-Control": "no-store" } });
}

async function postCallback(request: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  const run = await authorizedRun(request, runId);
  if (!run) return researchJsonResponse({ error: "Not available" }, { status: 403 });
  const parsed = actionSchema.safeParse(await researchRequestJson(request).catch(() => null));
  if (!parsed.success) return researchJsonResponse({ error: "Invalid Firmable workflow action" }, { status: 400 });
  const action = parsed.data;
  setResearchDatabaseContext({ runId, organizationId: run.organizationId, action: action.action, stage: "company-enrichment" });
  if (run.status === "failed") return researchJsonResponse({ failed: true });
  try {
    if (action.action === "company") return researchJsonResponse(await refreshFirmableCompany(runId, action.mandateId));
    if (action.action === "people-page") return researchJsonResponse(await refreshFirmablePeoplePage(runId, action.offset));
    if (action.action === "finalize-search") return researchJsonResponse(await finalizeFirmablePeopleSearch(runId, action.offset));
    if (action.action === "profiles") return researchJsonResponse(await refreshFirmableProfileBatch(runId, action.offset));
    if (action.action === "complete") return researchJsonResponse(await completeFirmableRefresh(runId, action.mandateId));
    await failFirmableRefresh(runId, action.message);
    return researchJsonResponse({ ok: true });
  } catch (error) {
    if (!(error instanceof FirmableError) || ![401, 402, 403].includes(error.status)) throw error;
    // Persist permanent account failures before acknowledging the workflow step.
    // Transient failures still use the workflow's normal retry policy.
    await failFirmableRefresh(runId, error.message);
    return researchJsonResponse({ failed: true });
  }
}

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) { return observeResearchRequest(request, () => getControl(request, context)); }
export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) { return observeResearchRequest(request, () => postCallback(request, context)); }
