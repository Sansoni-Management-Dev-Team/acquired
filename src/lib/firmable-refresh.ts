import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { FirmableClient, FirmableError, mapFirmablePerson } from "@/adapters/firmable-client";
import { createTargetDataProvider } from "@/adapters/provider-mode";
import { mapFirmableCompany } from "@/adapters/firmable-mapper";
import { upsertFirmableContact } from "@/db/firmable-contacts";
import { FirmableHistoryRepository } from "@/db/firmable-history-repository";
import { requireDb } from "@/db/client";
import { contacts, mandateTargets, targets, firmableSyncRuns } from "@/db/schema";
import { AcquisitionRepository } from "@/db/acquisition-repository";
import { OrganizationRepository } from "@/db/repositories";
import { briefToMandate } from "@/domain/acquisition";
import { rankTarget } from "@/domain/scoring";
import { validateCompanyWebsite } from "@/lib/company-website";

const PAGE_SIZE = 100;
const PROFILE_BATCH_SIZE = 5;
const RELATIONSHIP_BATCH_SIZE = 20;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

async function context(runId: string, mandateId?: string) {
  const database = requireDb();
  const history = new FirmableHistoryRepository(database);
  const run = await history.run(runId);
  if (!run) throw new Error("Company data refresh not found");
  if (mandateId) {
    const [membership] = await database.select({ targetId: mandateTargets.targetId }).from(mandateTargets).where(and(
      eq(mandateTargets.organizationId, run.organizationId),
      eq(mandateTargets.mandateId, mandateId),
      eq(mandateTargets.targetId, run.targetId),
    )).limit(1);
    if (!membership) throw new Error("Company data refresh target is not in this mandate");
  }
  return { database, history, run };
}

function client(history: FirmableHistoryRepository, runId: string) {
  return createTargetDataProvider(undefined, {
    onObservation: observation => history.recordObservation(runId, observation, {
      retainPersonalData: process.env.ALLOW_REAL_PERSONAL_DATA === "true",
    }),
  }).firmable;
}

export async function refreshFirmableCompany(runId: string, mandateId: string) {
  const { database, history, run } = await context(runId, mandateId);
  if (["complete", "partial", "failed"].includes(run.status)) return { companyId: run.firmableCompanyId };
  await history.markRunning(runId);
  if (run.trigger === 'phones') {
    const [target] = await database.select().from(targets).where(and(eq(targets.id, run.targetId), eq(targets.organizationId, run.organizationId)));
    if (!target?.firmableCompanyId) throw Error('Saved company match required for phone lookup');
    const people = await database.select({id: contacts.id}).from(contacts).where(and(eq(contacts.targetId, run.targetId), eq(contacts.organizationId, run.organizationId)));
    await database.update(firmableSyncRuns).set({ firmableCompanyId: target.firmableCompanyId, companyStatus: 'complete', searchStatus: 'complete', profilesFound: people.length }).where(eq(firmableSyncRuns.id, runId));
    return { companyId: target.firmableCompanyId, phoneOnly: true };
  }
  // Discovery already saved and verified this company; preserve its bands and ABN.
  if (run.trigger === 'discovery' && run.companyStatus === 'complete' && run.firmableCompanyId) {
    await history.updateProgress(runId, { searchStatus: 'running', message: 'Company already saved; finding people' });
    return { companyId: run.firmableCompanyId };
  }
  const repo = new AcquisitionRepository(run.organizationId, database);
  const mandate = await repo.getMandate(mandateId);
  if (!mandate) throw new Error("Mandate not found");
  const membership = (await repo.memberships(mandateId)).find(item => item.target.id === run.targetId);
  if (!membership) throw new Error("Target not found in mandate");
  const target = membership.target;
  const abn = target.abn || target.sourceData?.manufacturingDirectory?.abn || target.sourceData?.firmable?.abn;
  const fixtureMode = process.env.TARGET_DATA_PROVIDER === "fixture";
  const cached = await history.findCompany({ firmableId: run.firmableCompanyId || target.sourceData?.firmable?.firmableId, domain: target.domain, abn });
  const knownCompanyId = run.firmableCompanyId || target.sourceData?.firmable?.firmableId || cached?.id;
  if (!target.domain && !abn && !knownCompanyId) throw new Error("A website, ABN or existing company match is required for enrichment");

  let verifiedDomain = target.domain;
  if (target.domain && !fixtureMode) {
    const validation = await validateCompanyWebsite(`https://${target.domain}/`, { timeoutMs: 3_000, maxRedirects: 2 });
    if (!validation.ok) {
      // A transient verifier failure is not evidence that the stored website is
      // wrong. Keep it in the database and prefer a stronger identifier.
      verifiedDomain = "";
      if (!abn && !knownCompanyId) throw new Error(`Website could not be verified: ${validation.reason}`);
    }
  }

  const stored = await history.successfulCompanyResponse(runId);
  let company: Record<string, unknown>;
  try {
    company = record(stored?.response) || await client(history, runId).enrichCompany({ name: target.companyName, ...(knownCompanyId ? { id: knownCompanyId } : verifiedDomain ? { fqdn: verifiedDomain } : { abn }) });
  } catch (error) {
    if (error instanceof FirmableError && [401, 402, 403].includes(error.status)) throw error;
    if (!knownCompanyId) throw error;
    await history.linkRunCompany(runId, knownCompanyId, "failed");
    await history.updateProgress(runId, { companyStatus: "failed", searchStatus: "running", message: "Company refresh failed; loading people from the last known company profile" });
    return { companyId: knownCompanyId, companyFailed: true };
  }
  const filters = briefToMandate(mandate.brief);
  const enriched = mapFirmableCompany(company, {
    id: target.sourceData?.googlePlaces?.placeId || run.targetId,
    name: target.companyName,
    formattedAddress: target.state,
    website: target.domain ? `https://${target.domain}` : undefined,
    state: target.state,
    manufacturingDirectory: target.sourceData?.manufacturingDirectory,
    discoverySource: target.sourceData?.manufacturingDirectory ? "manufacturing-directory" : "google-places",
  }, filters, run.organizationId);
  enriched.domain = target.domain || enriched.domain;
  if (enriched.domain && enriched.domain !== target.domain && !fixtureMode) {
    const validation = await validateCompanyWebsite(`https://${enriched.domain}/`, { timeoutMs: 3_000, maxRedirects: 2 });
    if (!validation.ok) enriched.domain = "";
  }
  const companyRepo = new OrganizationRepository(database, run.organizationId);
  const saved = await companyRepo.upsertEnrichedTarget({ target: rankTarget(enriched, filters), mandateId, actorId: run.actorId, existingTargetId: run.targetId });
  if (saved) await repo.attach(mandateId, saved.id);
  const companyId = String(company.id);
  await history.updateProgress(runId, { companyStatus: "complete", searchStatus: "running", message: "Company saved; finding people" });
  return { companyId };
}

export async function refreshFirmablePeoplePage(runId: string, offset: number) {
  if (!Number.isInteger(offset) || offset < 0 || offset >= 10_000 || offset % PAGE_SIZE) throw new Error("Invalid people search offset");
  const { history, run } = await context(runId);
  if (!run.firmableCompanyId) throw new Error("Company data has not been saved");
  const before = await history.searchCandidates(runId, offset);
  let page = await history.successfulSearchPage(runId, offset);
  if (!page) {
    await client(history, runId).searchPeoplePage(run.firmableCompanyId, { max: PAGE_SIZE, from: offset });
    page = await history.successfulSearchPage(runId, offset);
  }
  if (!page) throw new Error("People search page was not persisted");
  const progress = await history.searchCandidates(runId);
  const returned = page.returnedCount || 0;
  if (progress.reportedTotals.length > 1) throw new Error("People search returned inconsistent totals");
  if (progress.malformedCount > 0) throw new Error("People search returned records without person IDs");
  if (progress.reportedTotal !== undefined && progress.candidates.length > progress.reportedTotal) throw new Error("People search returned more unique people than its reported total");
  const complete = progress.reportedTotal !== undefined
    ? progress.candidates.length === progress.reportedTotal
    : returned < PAGE_SIZE;
  if (!complete && returned < PAGE_SIZE) throw new Error("People search ended before its reported total");
  if (!complete && progress.candidates.length <= before.candidates.length) throw new Error("People search pagination did not advance");
  await history.updateProgress(runId, {
    searchStatus: complete ? "complete" : "running",
    profilesFound: progress.candidates.length,
    message: complete ? `Found ${progress.candidates.length} people` : `Finding people (${progress.candidates.length} found)`,
  });
  return { complete, nextOffset: offset + PAGE_SIZE, found: progress.candidates.length };
}

export async function finalizeFirmablePeopleSearch(runId: string, offset = 0) {
  if (!Number.isInteger(offset) || offset < 0 || offset >= 10_000) throw new Error("Invalid relationship offset");
  const { history, run } = await context(runId);
  if (!run.firmableCompanyId) throw new Error("Company data has not been saved");
  const progress = await history.searchCandidates(runId);
  const nextOffset = Math.min(offset + RELATIONSHIP_BATCH_SIZE, progress.candidates.length);
  const complete = nextOffset >= progress.candidates.length;
  await history.reconcilePeople(runId, run.firmableCompanyId, progress.candidates.slice(offset, nextOffset), false, process.env.ALLOW_REAL_PERSONAL_DATA === "true");
  if (complete) await history.completePeopleReconciliation(runId, run.firmableCompanyId, progress.candidates.map(candidate => candidate.id));
  await history.updateProgress(runId, { searchStatus: complete ? "complete" : "reconciling", profilesFound: progress.candidates.length, message: complete ? `Loading ${progress.candidates.length} profiles` : `Saving people (${nextOffset}/${progress.candidates.length})` });
  return { found: progress.candidates.length, nextOffset, complete };
}

export async function refreshFirmableProfileBatch(runId: string, offset: number) {
  if (!Number.isInteger(offset) || offset < 0 || offset >= 10_000) throw new Error("Invalid profile offset");
  const { database, history, run } = await context(runId);
  if (!run.firmableCompanyId) throw new Error("Company data has not been saved");
  const { candidates } = await history.searchCandidates(runId);
  const batch = candidates.slice(offset, offset + PROFILE_BATCH_SIZE);
  const existingContacts = batch.length ? await database.select({ personId: contacts.firmablePersonId }).from(contacts).where(and(
    eq(contacts.organizationId, run.organizationId),
    eq(contacts.targetId, run.targetId),
    inArray(contacts.firmablePersonId, batch.map(candidate => candidate.id)),
  )) : [];
  const existingIds = new Set(existingContacts.flatMap(row => row.personId ? [row.personId] : []));
  const provider = client(history, runId);
  const results = await Promise.allSettled(batch.map(async candidate => {
    try {
      const stored = await history.successfulPersonResponse(runId, candidate.id);
      const raw = record(stored?.response);
      if (stored && !raw && existingIds.has(candidate.id)) return;
      const person = raw
        ? mapFirmablePerson(raw, { id: candidate.id }, process.env.ALLOW_REAL_PERSONAL_DATA !== "true")
        : await provider.enrichPerson({ id: candidate.id }, { includePhones: !['discovery', 'people'].includes(run.trigger) });
      if (['discovery', 'people'].includes(run.trigger)) { person.phone = undefined; person.phoneAvailable = false; }
      await upsertFirmableContact({ database, organizationId: run.organizationId, targetId: run.targetId, companyId: run.firmableCompanyId!, person, candidate });
    } catch (error) {
      if (error instanceof FirmableError && ![401, 402, 403].includes(error.status)) return;
      throw error;
    }
  }));
  const infrastructureFailure = results.find(result => result.status === "rejected");
  if (infrastructureFailure?.status === "rejected") throw infrastructureFailure.reason;
  const counts = await history.profileProgress(runId, candidates.map(candidate => candidate.id));
  const nextOffset = Math.min(offset + PROFILE_BATCH_SIZE, candidates.length);
  await history.updateProgress(runId, {
    profilesFound: counts.found,
    profilesSaved: counts.saved,
    profilesFailed: counts.failed,
    message: `Loaded ${nextOffset} of ${candidates.length} profiles`,
  });
  return { ...counts, nextOffset, complete: nextOffset >= candidates.length };
}

export async function completeFirmableRefresh(runId: string, mandateId: string) {
  const { database, history, run } = await context(runId, mandateId);
  const { candidates } = await history.searchCandidates(runId);
  const counts = await history.profileProgress(runId, candidates.map(candidate => candidate.id));
  if (counts.pending) throw new Error(`${counts.pending} profiles were not attempted`);
  const successfulIds = new Set((await Promise.all(candidates.map(async candidate => await history.successfulPersonResponse(runId, candidate.id) ? candidate.id : undefined))).filter((id): id is string => Boolean(id)));
  const materialized = successfulIds.size ? await database.select({ personId: contacts.firmablePersonId }).from(contacts).where(and(
    eq(contacts.organizationId, run.organizationId),
    eq(contacts.targetId, run.targetId),
    inArray(contacts.firmablePersonId, [...successfulIds]),
  )) : [];
  const materializedIds = new Set(materialized.flatMap(row => row.personId ? [row.personId] : []));
  const missing = [...successfulIds].filter(id => !materializedIds.has(id));
  if (missing.length) throw new Error(`${missing.length} successful profiles were not saved as contacts`);
  await history.finishRun(runId, {
    ...counts,
    searchComplete: true,
    partial: run.companyStatus === "failed",
    message: run.companyStatus === "failed"
      ? "People refreshed from the last known company profile; the company refresh failed"
      : counts.found === 0
        ? "Company data saved; no people found"
        : undefined,
  });
  await new OrganizationRepository(database, run.organizationId).appendAudit({
    actorId: run.actorId,
    action: "target.firmable_people_synced",
    entityType: "target",
    entityId: run.targetId,
    metadata: { mandateId, firmableId: run.firmableCompanyId, ...counts },
  });
  return counts;
}

export async function failFirmableRefresh(runId: string, message: string) {
  const { history } = await context(runId);
  await history.failRun(runId, message.slice(0, 500));
}

/** Explicit manual enrichment only. Existing people and emails are preserved.
 * A durable per-contact marker prevents workflow retries from repeating an
 * uncertain credit-bearing request. A new user action may retry it. */
export async function refreshFirmablePhoneBatch(runId: string, offset: number) {
  if (!Number.isInteger(offset) || offset < 0 || offset >= 10000) throw Error('Invalid phone offset');
  const { database, history, run } = await context(runId);
  if (run.trigger !== 'phones') throw Error('Phone lookup requires explicit manual enrichment');
  const all = await database.select().from(contacts).where(and(eq(contacts.organizationId, run.organizationId), eq(contacts.targetId, run.targetId))).orderBy(contacts.createdAt, contacts.id);
  const batch = all.slice(offset, offset + 5);
  const provider = new FirmableClient({ retries: 0 });
  for (const contact of batch) {
    const data = contact.personalData as Record<string, unknown>;
    const provenance = contact.provenance as Record<string, unknown>;
    const previous = provenance.phoneLookup as { runId?: string; status?: string } | undefined;
    if (data.phone || previous?.runId === runId || !contact.firmablePersonId) continue;
    const claimed = await database.update(contacts).set({ provenance: sql`${contacts.provenance} || ${JSON.stringify({ phoneLookup: { runId, status: 'pending', requestedAt: new Date().toISOString() } })}::jsonb` }).where(and(eq(contacts.id, contact.id), sql`COALESCE(${contacts.provenance}->'phoneLookup'->>'runId', '') <> ${runId}`, sql`COALESCE(${contacts.personalData}->>'phone', '') = ''`)).returning({id:contacts.id});
    if (!claimed.length) continue;
    let status = 'not_available', message: string | undefined;
    try {
      const result = await provider.revealPersonPhones(contact.firmablePersonId);
      const person = mapFirmablePerson(result, { id: contact.firmablePersonId }, process.env.ALLOW_REAL_PERSONAL_DATA !== 'true');
      if (person.phone && !/[*x•]/i.test(person.phone) && person.phone.replace(/\D/g, '').length >= 7) {
        await database.update(contacts).set({ personalData: sql`${contacts.personalData} || ${JSON.stringify({ phone: person.phone, phoneAvailable: true, doNotContact: data.doNotContact === true || person.doNotContact })}::jsonb` }).where(eq(contacts.id, contact.id));
        status = 'saved';
      }
    } catch (error) {
      status = 'failed'; message = error instanceof Error ? error.message : 'Phone lookup failed';
      await database.update(contacts).set({ provenance: sql`${contacts.provenance} || ${JSON.stringify({ phoneLookup: { runId, status, message } })}::jsonb` }).where(eq(contacts.id, contact.id));
      if (error instanceof FirmableError && [401, 402, 403].includes(error.status)) throw error;
    }
    await database.update(contacts).set({ provenance: sql`${contacts.provenance} || ${JSON.stringify({ phoneLookup: { runId, status, message, checkedAt: new Date().toISOString() } })}::jsonb` }).where(eq(contacts.id, contact.id));
  }
  const current = await database.select().from(contacts).where(and(eq(contacts.organizationId, run.organizationId), eq(contacts.targetId, run.targetId)));
  const saved = current.filter(c => Boolean((c.personalData as { phone?: string }).phone)).length;
  const failed = current.filter(c => { const lookup = (c.provenance as {phoneLookup?: {runId:string;status:string}}).phoneLookup; return lookup?.runId === runId && ['failed', 'pending'].includes(lookup.status); }).length;
  const nextOffset = Math.min(offset + batch.length, all.length), complete = nextOffset >= all.length;
  await history.updateProgress(runId, { profilesFound: all.length, profilesSaved: saved, profilesFailed: failed, message: `Checked ${nextOffset}/${all.length} contacts; ${saved} phone numbers available` });
  if (complete) await history.finishRun(runId, { found: all.length, saved, failed, searchComplete: true, message: `Phone lookup finished: ${saved} numbers available across ${all.length} contacts` });
  return { nextOffset, complete, saved, failed };
}
