import { z } from "zod";
import { businessResultLimitSchema, resolveBusinessResultLimit } from "@/adapters/google-places-client";
import { searchAndEnrichTargets, targetSearchLog } from "@/adapters/live-target-search";
import { createTargetDataProvider } from "@/adapters/provider-mode";
import { acquireTargetSearch, TargetSearchRateLimitError } from "@/adapters/target-search-guard";
import { auth } from "@/lib/auth";
import { parseMandate } from "@/domain/mandate";
import { rankTargets } from "@/domain/scoring";
import { mandateConfirmation } from "@/domain/mandate";
import { requireDb } from "@/db/client";
import { OrganizationRepository } from "@/db/repositories";
import type { RankedTarget } from "@/domain/models";

const requestSchema = z.object({
  query: z.string().trim().min(10).max(500),
  limit: businessResultLimitSchema,
});

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "You must be signed in to search." }, { status: 401 });
  const organisationId = session.session.activeOrganizationId;
  if (!organisationId) return Response.json({ error: "Select an organisation before searching." }, { status: 403 });

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Enter a natural-language mandate and choose a valid result limit." }, { status: 400 });

  targetSearchLog("request.received", { query: parsed.data.query, requestedLimit: parsed.data.limit });

  const provider = createTargetDataProvider();
  const { places, firmable } = provider;
  targetSearchLog("provider.selected", { mode: provider.mode });
  if (provider.mode === "live" && (!places.isConfigured() || !firmable.isConfigured())) {
    targetSearchLog("request.rejected", { reason: "Provider configuration missing", googlePlacesConfigured: places.isConfigured(), firmableConfigured: firmable.isConfigured() });
    return Response.json({
      error: "Live search requires GOOGLE_PLACES_API_KEY and FIRMABLE_API_KEY on the server. No provider request was made.",
    }, { status: 503 });
  }

  let releaseSearch: () => void;
  try {
    releaseSearch = acquireTargetSearch(organisationId);
  } catch (error) {
    if (error instanceof TargetSearchRateLimitError) {
      targetSearchLog("request.rate_limited", { organizationId: organisationId, retryAfterSeconds: error.retryAfterSeconds, reason: error.message });
      return Response.json({ error: error.message }, { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } });
    }
    throw error;
  }

  try {
    const mandate = parseMandate(parsed.data.query);
    targetSearchLog("mandate.parsed", { sectors: mandate.sectors, states: mandate.states, locations: mandate.locations, revenue: mandate.revenue, ebitda: mandate.ebitda, headcount: mandate.headcount });
    const result = await searchAndEnrichTargets({ places, firmable, mandate, limit: parsed.data.limit, organisationId });
    const rankedTargets = rankTargets(result.targets, mandate);
    const repository = new OrganizationRepository(requireDb(), organisationId);
    const storedMandate = await repository.createMandate({
      naturalLanguage: parsed.data.query,
      filters: mandate,
      confirmation: mandateConfirmation(mandate),
      createdBy: session.user.id,
    });
    let persistedTargets: RankedTarget[] = [];
    for (const target of rankedTargets) {
      const saved = await repository.upsertEnrichedTarget({ target, mandateId: storedMandate.id, actorId: session.user.id });
      persistedTargets.push(saved ? { ...target, id: saved.id } : target);
    }
    const savedTargets = await repository.listRankedTargets();
    const savedById = new Map(savedTargets.map((target) => [target.id, target]));
    persistedTargets = persistedTargets.map((target) => savedById.get(target.id) || target);
    result.summary.persisted = persistedTargets.filter((target) => target.status === "enriched").length;
    targetSearchLog("database.persisted", { mandateId: storedMandate.id, targetCount: result.summary.persisted });
    targetSearchLog("response.ready", {
      effectiveLimit: resolveBusinessResultLimit(parsed.data.limit),
      resultCount: persistedTargets.length,
      results: persistedTargets.map((target) => ({
        id: target.id,
        companyName: target.companyName,
        domain: target.domain,
        status: target.status,
        scores: target.scores,
      })),
    });
    return Response.json({
      mandate,
      targets: persistedTargets,
      summary: result.summary,
      effectiveLimit: resolveBusinessResultLimit(parsed.data.limit),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Live target search failed";
    targetSearchLog("request.failed", { message });
    return Response.json({ error: message }, { status: 502 });
  } finally {
    releaseSearch();
  }
}
