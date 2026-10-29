import {completesWorkItems} from '@/domain/research-completion';
import {continueCompanyPeople} from './company-people-continuation';
import type { PersonCandidate, PersonDetail } from "@/adapters/source-contracts";
import { COMPANY_CONTACT_POLICY } from '@/domain/company-contact-policy';
import {companyDiscoveryPolicySchema} from '@/domain/research-discovery-policy';
import type {ResearchConfig} from '@/domain/research';
import "server-only";
import {researchTraceContext} from './research-request-observability';

import { and, eq, inArray, sql } from "drizzle-orm";
import { FirmableClient, FirmableError, mapFirmablePerson } from "@/adapters/firmable-client";
import { createTargetDataProvider } from "@/adapters/provider-mode";
import { mapFirmableCompany } from "@/adapters/firmable-mapper";
import { upsertFirmableContact } from "@/db/firmable-contacts";
import { FirmableHistoryRepository } from "@/db/firmable-history-repository";
import { requireDb } from "@/db/client";
import { contacts, mandateTargets, targets, firmableSyncRuns, researchJobs } from "@/db/schema";
import { AcquisitionRepository } from "@/db/acquisition-repository";
import { OrganizationRepository } from "@/db/repositories";
import { briefToMandate } from "@/domain/acquisition";
import { rankTarget } from "@/domain/scoring";
import { validateCompanyWebsite } from "@/lib/company-website";

import {appendFirmableSyncCompanyObservation} from '@/db/company-sync-observation-store';
import {companyIdentityDrizzleClient,CompanyIdentityReviewError} from '@/db/company-identity-store';

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

/** Original discovery root owns this bound; request input cannot expand it. */
async function automaticPeopleLimits(database:ReturnType<typeof requireDb>,run:typeof firmableSyncRuns.$inferSelect){
 const legacy={maxProfiles:COMPANY_CONTACT_POLICY.maxProfiles as number,maxSearchPages:COMPANY_CONTACT_POLICY.maxSearchPages as number,pageSize:PAGE_SIZE as number,profileLimit:Infinity,frozen:false};
 if(run.trigger!=='discovery')return legacy;
 const source=run.requestKey?.match(/^discovery:([0-9a-f-]{36}):([0-9a-f-]{36})$/i);
 if(!source)return legacy;
 const [root]=await database.select().from(researchJobs).where(and(eq(researchJobs.id,source[1]),eq(researchJobs.organizationId,run.organizationId))).limit(1);
 if(!root||root.organizationId!==run.organizationId||root.createdBy!==run.actorId||source[2]!==run.targetId)throw Error('Automatic People source is no longer current');
 const config=root.config as ResearchConfig;
 if(config.companyDiscoveryPolicy?.version!==5)return legacy;
 if(config.nativeAgent)throw Error('Native People requires its original metered authority');
 const policy=companyDiscoveryPolicySchema.parse(config.companyDiscoveryPolicy);
 if(policy.version!==5||config.companyIdentityPolicyVersion!==1||config.includeCompanyPeople!==true||config.includePhones!==false||config.findPeople!==false||config.companyOnly!==undefined||!config.companyPeopleRunIds?.includes(run.id)||(root.status==='cancelled'||root.status==='failed'&&!completesWorkItems(config)))throw Error('Automatic People source scope changed');
 return {maxProfiles:policy.automaticPeople.maxContactsPerCompany,maxSearchPages:policy.automaticPeople.maxSearchPagesPerCompany,pageSize:policy.automaticPeople.searchPageSize,profileLimit:policy.automaticPeople.maxContactsPerCompany,frozen:true};
}

function client(history: FirmableHistoryRepository, runId: string) {
  return createTargetDataProvider(undefined, {
    traceContext:{...researchTraceContext(),runId},
    onObservation: observation => history.recordObservation(runId, observation, {
      retainPersonalData: process.env.ALLOW_REAL_PERSONAL_DATA === "true",
    }),
  }).firmable;
}

export async function refreshFirmableCompany(runId: string, mandateId: string) {
  const { database, history, run } = await context(runId, mandateId);
  if (["complete", "partial", "failed", "cancelled"].includes(run.status)) return { companyId: run.firmableCompanyId };
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
  const currentRun=await history.run(runId);
  if(!currentRun)throw new CompanyIdentityReviewError('Company refresh source unavailable.',404);
  const firmable=enriched.sourceData?.firmable;
  const observedAbn=firmable?.abn?.replace(/\D/g,'');
  const companyId=String(company.id);
  const accepted=await database.transaction(tx=>appendFirmableSyncCompanyObservation(companyIdentityDrizzleClient(tx),{organizationId:run.organizationId,userId:run.actorId},{
    runId,mandateId,targetId:run.targetId,expectedGeneration:currentRun.generation,
    source:{companyName:enriched.companyName,domain:enriched.domain,firmableId:companyId,...(observedAbn?{abn:observedAbn}:{})},
    sourceFacts:{firmableCompanyId:companyId,identifiers:{firmableId:companyId,...(observedAbn?{abn:observedAbn}:{}),...(firmable?.acn?{acn:firmable.acn}:{}),...(firmable?.anzsic?{anzsic:firmable.anzsic}:{})},firmographics:{suburb:enriched.suburb,state:enriched.state,sector:enriched.sector,revenue:enriched.revenue,ebitda:enriched.ebitda,headcount:enriched.headcount,headcountBand:enriched.headcountBand,establishedYear:enriched.establishedYear,firmable,...(enriched.sourceData?.manufacturingDirectory?{manufacturingDirectory:enriched.sourceData.manufacturingDirectory}:{})}},
  }));
  if(accepted.handled){
    await history.updateProgress(runId,{companyStatus:'complete',searchStatus:'running',message:'Current company facts saved; finding people'});
    return {companyId};
  }
  enriched.domain = target.domain || enriched.domain;
  if (enriched.domain && enriched.domain !== target.domain && !fixtureMode) {
    const validation = await validateCompanyWebsite(`https://${enriched.domain}/`, { timeoutMs: 3_000, maxRedirects: 2 });
    if (!validation.ok) enriched.domain = "";
  }
  const companyRepo = new OrganizationRepository(database, run.organizationId);
  const saved = await companyRepo.upsertEnrichedTarget({ target: rankTarget(enriched, filters), mandateId, actorId: run.actorId, existingTargetId: run.targetId });
  if (saved) await repo.attach(mandateId, saved.id);
  await history.updateProgress(runId, { companyStatus: "complete", searchStatus: "running", message: "Company saved; finding people" });
  return { companyId };
}

export async function refreshFirmablePeoplePage(runId: string, offset: number) {
  if (!Number.isInteger(offset) || offset < 0 || offset >= 10_000 || offset % PAGE_SIZE) throw new Error("Invalid people search offset");
  const { database, history, run } = await context(runId);
  if (['failed', 'complete', 'partial', 'cancelled'].includes(run.status)) throw new Error('Contact run is terminal; no new work admitted');
  if (!run.firmableCompanyId) throw new Error("Company data has not been saved");
  const limits=await automaticPeopleLimits(database,run);
  if(limits.frozen&&offset>=limits.maxSearchPages*limits.pageSize)throw Error('Frozen People search scope exhausted');
  const before = await history.searchCandidates(runId, offset);
  let page = await history.successfulSearchPage(runId, offset);
  if (!page) {
    await client(history, runId).searchPeoplePage(run.firmableCompanyId, { max: limits.pageSize, from: offset });
    page = await history.successfulSearchPage(runId, offset);
  }
  if (!page) throw new Error("People search page was not persisted");
  const progress = await history.searchCandidates(runId);
  const returned = page.returnedCount || 0;
  if (progress.reportedTotals.length > 1) throw new Error("People search returned inconsistent totals");
  if (progress.malformedCount > 0) throw new Error("People search returned records without person IDs");
  if (progress.reportedTotal !== undefined && (progress.discoveredCount ?? progress.candidates.length) > progress.reportedTotal) throw new Error("People search returned more unique people than its reported total");
  const complete = ['discovery', 'people', 'manual'].includes(run.trigger)
    ? progress.candidates.length >= limits.maxProfiles || returned < limits.pageSize || offset / limits.pageSize + 1 >= limits.maxSearchPages
    : progress.reportedTotal !== undefined
    ? progress.candidates.length === progress.reportedTotal
    : returned < PAGE_SIZE;
  if (!['discovery', 'people', 'manual'].includes(run.trigger) && !complete && returned < PAGE_SIZE) throw new Error("People search ended before its reported total");
  if (!complete && (progress.discoveredCount ?? progress.candidates.length) <= (before.discoveredCount ?? before.candidates.length)) throw new Error("People search pagination did not advance");
  await history.updateProgress(runId, {
    searchStatus: complete ? "complete" : "running",
    profilesFound: progress.discoveredCount ?? progress.candidates.length,
    message: complete ? `Found ${progress.candidates.length} people` : `Finding people (${progress.candidates.length} found)`,
  });
  return { complete, nextOffset: offset + limits.pageSize, found: progress.candidates.length };
}

export async function finalizeFirmablePeopleSearch(runId: string, offset = 0) {
  if (!Number.isInteger(offset) || offset < 0 || offset >= 10_000) throw new Error("Invalid relationship offset");
  const { database, history, run } = await context(runId);
  if (['failed', 'complete', 'partial', 'cancelled'].includes(run.status)) throw new Error('Contact run is terminal; no new work admitted');
  if (!run.firmableCompanyId) throw new Error("Company data has not been saved");
  const limits=await automaticPeopleLimits(database,run);
  const found = await history.searchCandidates(runId);
  const progress={...found,candidates:found.candidates.slice(0,limits.profileLimit)};
  const nextOffset = Math.min(offset + RELATIONSHIP_BATCH_SIZE, progress.candidates.length);
  const complete = nextOffset >= progress.candidates.length;
  await history.reconcilePeople(runId, run.firmableCompanyId, progress.candidates.slice(offset, nextOffset), false, process.env.ALLOW_REAL_PERSONAL_DATA === "true");
  // Bounded decision-maker selection is not a complete workforce census.
  if (complete && !['discovery', 'people', 'manual'].includes(run.trigger)) await history.completePeopleReconciliation(runId, run.firmableCompanyId, progress.candidates.map(candidate => candidate.id));
  await history.updateProgress(runId, { searchStatus: complete ? "complete" : "reconciling", profilesFound: progress.discoveredCount ?? progress.candidates.length, message: complete ? `Loading ${progress.candidates.length} profiles` : `Saving people (${nextOffset}/${progress.candidates.length})` });
  return { found: progress.candidates.length, nextOffset, complete };
}

/** Shared bounded People execution. Callers retain their original authority,
 * durable receipts, source checks and persistence transactions. This capability
 * owns profile reuse/admission/fetch/save and phone suppression in both modes. */
export async function executeFirmablePeopleProfiles(input: {
  candidates: PersonCandidate[];
  includePhones: boolean;
  concurrency: 'serial' | 'parallel';
  recorded(candidate: PersonCandidate): Promise<
    { kind: 'saved'; saved: boolean } | { kind: 'profile'; person: PersonDetail } | undefined
  >;
  admissible?(candidate: PersonCandidate): Promise<boolean>;
  enrich(id: { id: string }, options: { includePhones: boolean }): Promise<PersonDetail>;
  persist(person: PersonDetail, candidate: PersonCandidate): Promise<boolean>;
  failure(error: unknown): void;
  settled?(): Promise<unknown>;
}) {
  let saved = 0, needsReview = 0;
  const context = researchTraceContext(), started = performance.now();
  const trace = (event: string, details: Record<string, string | number | boolean>) => console.info('research-pipeline', JSON.stringify({
    event, module: 'people.profiles', timestamp: new Date().toISOString(), ...context, ...details,
  }));
  trace('people_profiles_started', { candidates: input.candidates.length, includePhones: input.includePhones, concurrency: input.concurrency });
  const execute = async (candidate: PersonCandidate) => {
    try {
      const recorded = await input.recorded(candidate);
      if (recorded?.kind === 'saved') {
        if (recorded.saved) saved++;
        return;
      }
      if (input.admissible && !await input.admissible(candidate)) { needsReview++; return; }
      const profile = recorded?.kind === 'profile' ? recorded.person
        : await input.enrich({ id: candidate.id }, { includePhones: input.includePhones });
      // Never carry provider-returned phone data through a phone-free action.
      const person = input.includePhones ? profile
        : { ...profile, phone: undefined, phoneAvailable: false, phoneLookupStatus: 'not_requested' as const };
      if (await input.persist(person, candidate)) saved++; else needsReview++;
    } catch (error) {
      needsReview++;
      trace('people_profile_failed', { needsReview });
      input.failure(error);
    } finally { await input.settled?.(); }
  };
  let completed = false;
  try {
    if (input.concurrency === 'serial') {
      for (const candidate of input.candidates) await execute(candidate);
    } else {
      // Drain admitted work before propagating an infrastructure failure.
      const results = await Promise.allSettled(input.candidates.map(execute));
      const failed = results.find(result => result.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
    }
    completed = true;
    return { saved, needsReview };
  } finally {
    trace('people_profiles_finished', { saved, needsReview, outcome: completed ? 'settled' : 'failed', elapsedMs: performance.now() - started });
  }
}

export async function refreshFirmableProfileBatch(runId: string, offset: number) {
  if (!Number.isInteger(offset) || offset < 0 || offset >= 10_000) throw new Error("Invalid profile offset");
  const { database, history, run } = await context(runId);
  if (['failed', 'complete', 'partial', 'cancelled'].includes(run.status)) throw new Error('Contact run is terminal; no new work admitted');
  if (!run.firmableCompanyId) throw new Error("Company data has not been saved");
  const limits=await automaticPeopleLimits(database,run);
  const found = await history.searchCandidates(runId);
  const candidates=found.candidates.slice(0,limits.profileLimit);
  const batch = candidates.slice(offset, offset + PROFILE_BATCH_SIZE);
  const existingContacts = batch.length ? await database.select({ personId: contacts.firmablePersonId }).from(contacts).where(and(
    eq(contacts.organizationId, run.organizationId),
    eq(contacts.targetId, run.targetId),
    inArray(contacts.firmablePersonId, batch.map(candidate => candidate.id)),
  )) : [];
  const existingIds = new Set(existingContacts.flatMap(row => row.personId ? [row.personId] : []));
  const provider = client(history, runId);
  await executeFirmablePeopleProfiles({
    candidates: batch,
    includePhones: !['discovery', 'people'].includes(run.trigger),
    concurrency: 'parallel',
    recorded: async candidate => {
      const stored = await history.successfulPersonResponse(runId, candidate.id);
      const raw = record(stored?.response);
      if (stored && !raw && existingIds.has(candidate.id)) return { kind: 'saved', saved: true };
      return raw ? { kind: 'profile', person: mapFirmablePerson(raw, { id: candidate.id }, process.env.ALLOW_REAL_PERSONAL_DATA !== 'true') } : undefined;
    },
    enrich: (identifier, options) => provider.enrichPerson(identifier, options),
    persist: async (person, candidate) => {
      await upsertFirmableContact({ database, organizationId: run.organizationId, targetId: run.targetId, companyId: run.firmableCompanyId!, person, candidate });
      return true;
    },
    failure: error => {
      if (error instanceof FirmableError && ![401, 402, 403].includes(error.status)) return;
      throw error;
    },
    settled: () => history.reconcileProfileProgress(runId),
  });
  const counts = await history.profileProgress(runId, candidates.map(candidate => candidate.id));
  const nextOffset = Math.min(offset + PROFILE_BATCH_SIZE, candidates.length);
  await history.updateProgress(runId, {
    message: `Loaded ${nextOffset} of ${candidates.length} profiles`,
  });
  return { ...counts, nextOffset, complete: nextOffset >= candidates.length };
}

export async function completeFirmableRefresh(runId: string, mandateId: string) {
  const { database, history, run } = await context(runId, mandateId);
  const limits=await automaticPeopleLimits(database,run);
  const found = await history.searchCandidates(runId);
  const candidates=found.candidates.slice(0,limits.profileLimit);
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
        ? "Company data saved; no decision makers found within contact search budget"
        : `Decision maker contacts saved (${counts.saved}/${counts.found}); at most ${limits.maxProfiles} selected from ${limits.maxSearchPages} search pages`,
  });
  await history.reconcileProfileProgress(runId);
  await new OrganizationRepository(database, run.organizationId).appendAudit({
    actorId: run.actorId,
    action: "target.firmable_people_synced",
    entityType: "target",
    entityId: run.targetId,
    metadata: { mandateId, firmableId: run.firmableCompanyId, ...counts },
  });
  try{await continueCompanyPeople(run);}catch{console.info('research-maintenance',JSON.stringify({event:'people_continuation_deferred',runId}));}
  return counts;
}

export async function failFirmableRefresh(runId: string, message: string) {
  const { history } = await context(runId);
  await history.failRun(runId, message.slice(0, 500));
  await history.reconcileProfileProgress(runId);
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
  const provider = new FirmableClient({ retries: 0,traceContext:{...researchTraceContext(),runId} });
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
        await database.update(contacts).set({ personalData: sql`${contacts.personalData} || ${JSON.stringify({ phone: person.phone, phoneAvailable: true, phoneSaved: true, phonePotentiallyAvailable: true, phoneLookupStatus: 'reported', doNotContact: data.doNotContact === true || person.doNotContact })}::jsonb` }).where(eq(contacts.id, contact.id));
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
