import {recoverFirmableRefreshes} from '@/lib/firmable-run-recovery';
import { researchJsonResponse, researchRequestJson } from "@/lib/research-request-observability";
import { observeResearchRequest } from "@/lib/research-request-observability";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { requireDb } from "@/db/client";
import { messages, sequenceEnrolments, organization, targets } from "@/db/schema";
import { buyerProfileFromMetadata } from "@/domain/buyer-profile";
import { AcquisitionRepository } from "@/db/acquisition-repository";
import { OrganizationRepository } from "@/db/repositories";
import { accreditationSchema, assessmentSchema, briefSchema, briefToMandate, searchReadiness, transitionErrors, valuationSchema } from "@/domain/acquisition";
import { rankTarget } from "@/domain/scoring";
import { discoverMandate } from "@/adapters/mandate-discovery";
import { createTargetDataProvider } from "@/adapters/provider-mode";
import { mapGooglePlace } from "@/adapters/firmable-mapper";
import { acquireTargetSearch, TargetSearchRateLimitError } from "@/adapters/target-search-guard";
import { FirmableHistoryRepository } from "@/db/firmable-history-repository";
import { loadWorkspaceContacts } from "@/db/firmable-read-model";
import { validateCompanyWebsite, validateTargetWebsites } from "@/lib/company-website";
import { researchEnabled, researchWorker } from "@/lib/research-service";
import { generateMandate } from "@/adapters/mandate-generation";

export const maxDuration = 300;

const importedRecord = z.object({ name: z.string().trim().min(1).max(300), website: z.union([z.string().url(), z.literal("")]), abn: z.string().regex(/^(\d{11})?$/), state: z.string().max(30), description: z.string().max(3000), source: z.string().trim().min(1).max(200), sourceUrl: z.string().url(), sourceId: z.string().trim().min(1).max(200) });
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("brief"), brief: briefSchema }),
  z.object({ action: z.literal("brief-description"), description: z.string().trim().min(10).max(10000) }),
  z.object({ action: z.literal("discover") }),
  z.object({ action: z.literal("import"), records: z.array(importedRecord).min(1).max(1000) }),
  z.object({ action: z.literal("enrich"), targetIds: z.array(z.string().uuid()).min(1).max(20), requestId: z.string().uuid().optional() }),
  z.object({ action: z.literal("assessment"), targetId: z.string().uuid(), assessment: assessmentSchema, version: z.number().int().positive() }),
  z.object({ action: z.literal("accreditations"), targetId: z.string().uuid(), accreditations: z.array(accreditationSchema).max(100) }),
  z.object({ action: z.literal("valuation"), observation: valuationSchema }),
  z.object({ action: z.literal("identity"), targetId: z.string().uuid(), website: z.union([z.string().url().refine(url => /^https?:\/\//i.test(url)), z.literal("")]), abn: z.string().regex(/^(\d{11})?$/), source: z.string().trim().min(1).max(500), sourceUrl: z.string().url() }),
]);

async function getMandateWorkspace(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  const org = session?.session.activeOrganizationId;
  if (!org) return researchJsonResponse({ error: "Sign in and select an organisation." }, { status: 401 });
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return researchJsonResponse({ error: "Invalid mandate" }, { status: 400 });
  const repo = new AcquisitionRepository(org);
  const mandate = await repo.getMandate(id);
  if (!mandate) return researchJsonResponse({ error: "Mandate not found" }, { status: 404 });
  const [memberships, coverage, valuations, orgRows] = await Promise.all([repo.memberships(id), repo.coverage(id), repo.valuations(id), requireDb().select({ metadata: organization.metadata }).from(organization).where(eq(organization.id, org))]);
  const history = new FirmableHistoryRepository(requireDb());
  const rawRunIds = new URL(request.url).searchParams.get("enrichmentRuns");
  const runIds = rawRunIds === null ? undefined : rawRunIds.split(",");
  if (runIds && (!runIds.length || runIds.length > 20 || runIds.some(runId => !z.uuid().safeParse(runId).success))) return researchJsonResponse({ error: "Invalid enrichment runs" }, { status: 400 });
  let firmableRefreshes = await history.latestRuns(org, memberships.map(item => item.target.id), runIds);
  if (researchEnabled()) {
    await recoverFirmableRefreshes(history, firmableRefreshes, id);
    firmableRefreshes = await history.latestRuns(org, memberships.map(item => item.target.id), runIds);
  }
  return researchJsonResponse({ mandate, memberships, coverage, valuations, buyerProfile: buyerProfileFromMetadata(orgRows[0]?.metadata), contacts: await loadWorkspaceContacts(requireDb(), org, memberships), firmableRefreshes });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: request.headers });
  const org = session?.session.activeOrganizationId;
  if (!org || !session) return researchJsonResponse({ error: "Sign in and select an organisation." }, { status: 401 });
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return researchJsonResponse({ error: "Invalid mandate" }, { status: 400 });
  const parsed = actionSchema.safeParse(await researchRequestJson(request).catch(() => null));
  if (!parsed.success) return researchJsonResponse({ error: parsed.error.issues.map(i => i.message).join("; ") }, { status: 400 });
  const action = parsed.data;
  const repo = new AcquisitionRepository(org);
  const mandate = await repo.getMandate(id);
  if (!mandate) return researchJsonResponse({ error: "Mandate not found" }, { status: 404 });
  let release: (() => void) | undefined;
  try {
    if (action.action === "brief-description") {
      if (action.description === mandate.brief.naturalLanguage) return researchJsonResponse({ ok: true, brief: mandate.brief });
      let generated;
      try { generated = await generateMandate(action.description); }
      catch { return researchJsonResponse({ error: "Could not update the search from your description. Please try again." }, { status: 503 }); }
      const brief = { ...generated, naturalLanguage: action.description, researchSources: mandate.brief.researchSources, disclosureApproved: mandate.brief.disclosureApproved };
      await repo.saveBrief(brief, session.user.id, id);
      return researchJsonResponse({ ok: true, brief });
    }
    if (action.action === "brief") await repo.saveBrief(action.brief, session.user.id, id);
    if (action.action === "assessment") {
      const errors = transitionErrors(mandate.brief, action.assessment);
      if (action.assessment.stage === "qualified") {
        if (!action.assessment.financeReview?.structureReviewed) errors.push("Review the proposed deal structure before qualification.");
      }
      if (action.assessment.stage === "outreach-approved") {
        const enrolments = await requireDb().select().from(sequenceEnrolments).where(and(eq(sequenceEnrolments.organizationId, org), eq(sequenceEnrolments.mandateId, id), eq(sequenceEnrolments.targetId, action.targetId)));
        const drafts = await requireDb().select().from(messages).where(eq(messages.organizationId, org));
        if (!drafts.some(d => enrolments.some(e => e.id === d.enrolmentId) && d.state === "approved")) errors.push("Approve an outreach draft before selecting this stage.");
      }
      if (errors.length) return researchJsonResponse({ error: errors.join(" ") }, { status: 409 });
      await repo.saveAssessment(id, action.targetId, action.assessment, action.version, session.user.id);
    }
    if (action.action === "accreditations") {
      await repo.saveAccreditations(id, action.targetId, action.accreditations);
      await new OrganizationRepository(requireDb(), org).appendAudit({ actorId: session.user.id, action: "target.accreditations_saved", entityType: "target", entityId: action.targetId, metadata: { mandateId: id, count: action.accreditations.length } });
    }
    if (action.action === "identity") {
      if (!(await repo.memberships(id)).some(m => m.target.id === action.targetId)) return researchJsonResponse({ error: "Target not found in mandate" }, { status: 404 });
      if (action.website) {
        const validation = await validateCompanyWebsite(action.website);
        if (!validation.ok) return researchJsonResponse({ error: `Website could not be verified: ${validation.reason}.` }, { status: 422 });
      }
      const domain = action.website ? new URL(action.website).hostname.replace(/^www\./, "").toLowerCase() : "";
      if (domain) {
        const [existing] = await requireDb().select({ id: targets.id }).from(targets).where(and(eq(targets.organizationId, org), eq(targets.domain, domain)));
        if (existing && existing.id !== action.targetId) return researchJsonResponse({ error: "This website belongs to another saved company. Review the duplicate before changing identity." }, { status: 409 });
      }
      const identity = { source: action.source, sourceUrl: action.sourceUrl, capturedAt: new Date().toISOString() };
      await requireDb().update(targets).set({ domain, identifiers: sql`${targets.identifiers} || ${JSON.stringify({ abn: action.abn, identityEvidence: identity })}::jsonb`, updatedAt: new Date() }).where(and(eq(targets.id, action.targetId), eq(targets.organizationId, org)));
      await new OrganizationRepository(requireDb(), org).appendAudit({ actorId: session.user.id, action: "target.identity_reviewed", entityType: "target", entityId: action.targetId, metadata: { mandateId: id } });
    }
    if (action.action === "valuation") {
      await repo.saveValuation(id, action.observation);
      await new OrganizationRepository(requireDb(), org).appendAudit({ actorId: session.user.id, action: "mandate.valuation_recorded", entityType: "mandate", entityId: id, metadata: { observationId: action.observation.id } });
    }
    if (["discover", "enrich", "import"].includes(action.action)) release = acquireTargetSearch(org);
    const filters = briefToMandate(mandate.brief);
    if (action.action === "discover") {
      const errors = searchReadiness(mandate.brief);
      if (!filters.states.length) errors.push("Use Australian state names/codes or National for geography.");
      if (errors.length) return researchJsonResponse({ error: errors.join(" ") }, { status: 409 });
      const companyRepo = new OrganizationRepository(requireDb(), org);
      const provider = createTargetDataProvider();
      const result = await discoverMandate({ directory: provider.manufacturingDirectory, places: provider.places, mandate: filters, organizationId: org });
      const checked = await validateTargetWebsites(result.targets);
      const warnings: string[] = [];
      for (const { target, validation } of checked) {
        if (validation && !validation.ok) {
          warnings.push(`${target.companyName}: website removed — ${validation.reason}.`);
          target.domain = "";
        }
        const saved = await companyRepo.upsertEnrichedTarget({ target: rankTarget(target, filters), mandateId: id, actorId: session.user.id });
        if (saved) await repo.attach(id, saved.id);
      }
      await repo.recordCoverage(id, result.sources);
      return researchJsonResponse({ ok: true, warnings });
    }
    if (action.action === "import") {
      const companyRepo = new OrganizationRepository(requireDb(), org);
      let added = 0;
      const before = new Set((await repo.memberships(id)).map(m => m.target.id));
      const candidates = action.records.map(record => {
        const directory = { recordId: `${record.source}:${record.sourceId}`, name: record.name, website: record.website || undefined, abn: record.abn || undefined, state: record.state, description: record.description, categories: [], keywords: [], capabilities: [], sourceRecords: [{ source: record.source, sourceId: record.sourceId, sourceUrl: record.sourceUrl }] };
        return mapGooglePlace({ id: directory.recordId, name: record.name, formattedAddress: record.state, website: record.website || undefined, state: record.state, discoverySource: "manufacturing-directory", manufacturingDirectory: directory }, filters, org, "Imported discovery record — enrichment pending");
      });
      const checked = await validateTargetWebsites(candidates);
      const warnings: string[] = [];
      for (const { target, validation } of checked) {
        if (validation && !validation.ok) {
          warnings.push(`${target.companyName}: website removed — ${validation.reason}.`);
          target.domain = "";
        }
        const saved = await companyRepo.upsertEnrichedTarget({ target: rankTarget(target, filters), mandateId: id, actorId: session.user.id });
        if (saved) { await repo.attach(id, saved.id); if (!before.has(saved.id)) { added++; before.add(saved.id); } }
      }
      await repo.recordCoverage(id, [{ name: "Sourced record import", status: "partial", discovered: action.records.length, unique: added, overlap: action.records.length - added, checkedAt: new Date().toISOString(), note: "User-supplied records; source population completeness has not been established." }]);
      return researchJsonResponse({ ok: true, warnings });
    }
    if (action.action === "enrich") {
      if (!researchEnabled()) return researchJsonResponse({ error: "Company data refresh is awaiting service activation" }, { status: 503 });
      if (process.env.TARGET_DATA_PROVIDER !== "fixture" && !process.env.FIRMABLE_API_KEY) return researchJsonResponse({ error: "Company data enrichment is not configured" }, { status: 503 });
      const memberships = await repo.memberships(id);
      if (action.targetIds.some(targetId => !memberships.some(m => m.target.id === targetId))) return researchJsonResponse({ error: "A target does not belong to this mandate" }, { status: 404 });
      const history = new FirmableHistoryRepository(requireDb());
      const warnings: string[] = [];
      const runs: { id: string; targetId: string; status: string }[] = [];
      const requestId = action.requestId || crypto.randomUUID();
      const dispatches: { run: { id: string; targetId: string; status: string }; companyName: string }[] = [];
      for (const targetId of [...new Set(action.targetIds)]) {
        const target = memberships.find(m => m.target.id === targetId)!.target;
        const abn = target.abn || target.sourceData?.manufacturingDirectory?.abn || target.sourceData?.firmable?.abn;
        if (!target.domain && !abn && !target.sourceData?.firmable?.firmableId) { warnings.push(`${target.companyName}: website, ABN or prior company match required; candidate retained.`); continue; }
        try {
          const run = await history.queueRun({ organizationId: org, actorId: session.user.id, targetId, requestKey: `${requestId}:${targetId}` });
          const queued = { id: run.id, targetId, status: run.status };
          runs.push(queued);
          dispatches.push({ run: queued, companyName: target.companyName });
        } catch {
          warnings.push(`${target.companyName}: refresh could not be queued; candidate retained.`);
        }
      }
      const dispatched = await Promise.allSettled(dispatches.map(item => researchWorker(`/firmable/${item.run.id}`, "POST", { mandateId: id }, 4_000)));
      dispatched.forEach((result, index) => {
        if (result.status === "rejected") warnings.push(`${dispatches[index].companyName}: refresh saved; dispatch is uncertain and will be retried automatically.`);
      });
      return researchJsonResponse({ ok: true, warnings, messages: [`${runs.length} company data refresh${runs.length === 1 ? "" : "es"} queued.`], refresh: { runs } }, { status: 202 });
    }
    return researchJsonResponse({ ok: true });
  } catch (error) {
    return researchJsonResponse({ error: error instanceof Error ? error.message : "Unable to save changes" }, { status: error instanceof TargetSearchRateLimitError ? 429 : 409 });
  } finally { release?.(); }
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return observeResearchRequest(request, () => getMandateWorkspace(request, context));
}
