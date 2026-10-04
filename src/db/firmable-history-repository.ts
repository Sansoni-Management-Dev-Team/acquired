import { and, asc, desc, eq, inArray, isNotNull, lt, lte, max, notInArray, or, sql } from "drizzle-orm";
import { isEmptyFirmablePeopleSearchResponse, mapFirmableCandidate, type FirmableHttpObservation } from "@/adapters/firmable-client";
import type { PersonCandidate } from "@/adapters/source-contracts";
import { normalizeFirmableAbn, normalizeFirmableDomain, responseHash } from "@/domain/firmable-history";
import { requireDb } from "./client";
import { contacts, mandateTargets, firmableCompanies, firmableCompanyPeople, firmableCompanyResponses, firmablePeople, firmablePeopleSearches, firmablePersonResponses, firmableSyncRuns, targets } from "./schema";

type Database = ReturnType<typeof requireDb>;

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function text(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : undefined; }
function number(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }

export type StoredFirmablePerson = {
  companyId: string;
  personId: string;
  searchRecord: Record<string, unknown>;
  profile?: Record<string, unknown>;
  fetchedAt?: Date;
};

export class FirmableHistoryRepository {
  constructor(private database: Database = requireDb()) {}

  private async createRun(input: { organizationId: string; actorId: string; targetId: string; requestKey?: string; trigger?: string; generation?: number }, status: "queued" | "running") {
    const requestKey = input.requestKey || crypto.randomUUID();
    const [run] = await this.database.insert(firmableSyncRuns).values({
      organizationId: input.organizationId,
      actorId: input.actorId,
      targetId: input.targetId,
      requestKey,
      trigger: input.trigger || "manual",
      generation: input.generation || 1,
      status,
      message: status === "queued" ? "Company data refresh queued" : "Refreshing company data",
      startedAt: status === "running" ? new Date() : undefined,
    }).onConflictDoNothing().returning();
    if (run) return run;
    const [existing] = await this.database.select().from(firmableSyncRuns).where(and(eq(firmableSyncRuns.organizationId, input.organizationId), eq(firmableSyncRuns.requestKey, requestKey))).limit(1);
    if (!existing) throw new Error("Unable to create company data refresh");
    return existing;
  }

  startRun(input: { organizationId: string; actorId: string; targetId: string; requestKey?: string; trigger?: string }) {
    return this.createRun(input, "running");
  }

  async queueRun(input: { organizationId: string; actorId: string; targetId: string; requestKey: string; trigger?: string }) {
    const [sameRequest] = await this.database.select().from(firmableSyncRuns).where(and(
      eq(firmableSyncRuns.organizationId, input.organizationId),
      eq(firmableSyncRuns.requestKey, input.requestKey),
    )).limit(1);
    if (sameRequest) return sameRequest;
    const [active] = await this.database.select().from(firmableSyncRuns).where(and(
      eq(firmableSyncRuns.organizationId, input.organizationId),
      eq(firmableSyncRuns.targetId, input.targetId),
      inArray(firmableSyncRuns.status, ["queued", "running"]),
    )).orderBy(desc(firmableSyncRuns.createdAt)).limit(1);
    if (active) return active;

    const [latest] = await this.database.select({ generation: max(firmableSyncRuns.generation) }).from(firmableSyncRuns).where(and(
      eq(firmableSyncRuns.organizationId, input.organizationId),
      eq(firmableSyncRuns.targetId, input.targetId),
    ));
    const generation = (latest?.generation || 0) + 1;
    const [created] = await this.database.insert(firmableSyncRuns).values({
      organizationId: input.organizationId,
      actorId: input.actorId,
      targetId: input.targetId,
      requestKey: input.requestKey,
      trigger: input.trigger || "manual",
      status: "queued",
      generation,
      message: "Company data refresh queued",
    }).onConflictDoNothing().returning();
    if (created) return created;
    const [winner] = await this.database.select().from(firmableSyncRuns).where(and(
      eq(firmableSyncRuns.organizationId, input.organizationId),
      eq(firmableSyncRuns.targetId, input.targetId),
      inArray(firmableSyncRuns.status, ["queued", "running"]),
    )).orderBy(desc(firmableSyncRuns.createdAt)).limit(1);
    if (!winner) throw new Error("Unable to queue company data refresh");
    return winner;
  }

  async run(runId: string) {
    return (await this.database.select().from(firmableSyncRuns).where(eq(firmableSyncRuns.id, runId)).limit(1))[0];
  }

  async latestRuns(organizationId: string, targetIds: string[], runIds?: string[]) {
    if (!targetIds.length) return [];
    return this.database.selectDistinctOn([firmableSyncRuns.targetId], {
      id: firmableSyncRuns.id,
      targetId: firmableSyncRuns.targetId,
      status: firmableSyncRuns.status,
      companyStatus: firmableSyncRuns.companyStatus,
      searchStatus: firmableSyncRuns.searchStatus,
      profilesFound: firmableSyncRuns.profilesFound,
      profilesSaved: firmableSyncRuns.profilesSaved,
      profilesFailed: firmableSyncRuns.profilesFailed,
      message: firmableSyncRuns.message,
      createdAt: firmableSyncRuns.createdAt,
      updatedAt: firmableSyncRuns.updatedAt,
    }).from(firmableSyncRuns).where(and(
      eq(firmableSyncRuns.organizationId, organizationId),
      inArray(firmableSyncRuns.targetId, targetIds),
      runIds ? inArray(firmableSyncRuns.id, runIds) : undefined,
    )).orderBy(firmableSyncRuns.targetId, desc(firmableSyncRuns.createdAt), desc(firmableSyncRuns.id));
  }

  async contactIdsForRuns(organizationId: string, mandateId: string, runIds: string[]) {
    if (!runIds.length) return [];
    const rows = await this.database.selectDistinct({ id: contacts.id }).from(contacts)
      .innerJoin(mandateTargets, and(eq(mandateTargets.targetId, contacts.targetId), eq(mandateTargets.organizationId, organizationId), eq(mandateTargets.mandateId, mandateId)))
      .innerJoin(firmableSyncRuns, and(eq(firmableSyncRuns.targetId, contacts.targetId), eq(firmableSyncRuns.organizationId, organizationId), inArray(firmableSyncRuns.id, runIds)))
      .leftJoin(firmablePersonResponses, and(eq(firmablePersonResponses.runId, firmableSyncRuns.id), eq(firmablePersonResponses.firmablePersonId, contacts.firmablePersonId), eq(firmablePersonResponses.successful, true)))
      .where(and(eq(contacts.organizationId, organizationId), or(eq(firmableSyncRuns.trigger, 'phones'), isNotNull(firmablePersonResponses.id))));
    return rows.map(row => row.id);
  }

  async markRunning(runId: string, message = "Refreshing company data") {
    await this.database.update(firmableSyncRuns).set({ status: "running", message, startedAt: sql`coalesce(${firmableSyncRuns.startedAt}, now())`, completedAt: null, updatedAt: new Date() }).where(and(eq(firmableSyncRuns.id, runId), inArray(firmableSyncRuns.status, ["queued", "running"])));
  }

  async updateProgress(runId: string, values: { companyStatus?: string; searchStatus?: string; profilesFound?: number; profilesSaved?: number; profilesFailed?: number; message?: string }) {
    await this.database.update(firmableSyncRuns).set({ ...values, updatedAt: new Date() }).where(and(eq(firmableSyncRuns.id, runId), inArray(firmableSyncRuns.status, ["queued", "running"])));
  }

  async linkRunCompany(runId: string, companyId: string, companyStatus = "failed") {
    const [existing] = await this.database.select({ firmableCompanyId: firmableSyncRuns.firmableCompanyId, companyStatus: firmableSyncRuns.companyStatus }).from(firmableSyncRuns).where(eq(firmableSyncRuns.id, runId)).limit(1);
    if (existing?.firmableCompanyId === companyId && existing.companyStatus === companyStatus) return;
    const [company] = await this.database.update(firmableCompanies).set({ peopleGeneration: sql`${firmableCompanies.peopleGeneration} + 1`, updatedAt: new Date() }).where(eq(firmableCompanies.id, companyId)).returning({ generation: firmableCompanies.peopleGeneration });
    if (!company) throw new Error("Company data record not found");
    const [run] = await this.database.update(firmableSyncRuns).set({ firmableCompanyId: companyId, companyStatus, generation: company.generation, updatedAt: new Date() }).where(and(eq(firmableSyncRuns.id, runId), inArray(firmableSyncRuns.status, ["queued", "running"]))).returning({ targetId: firmableSyncRuns.targetId });
    if (run) await this.database.update(targets).set({ firmableCompanyId: companyId, updatedAt: new Date() }).where(eq(targets.id, run.targetId));
  }

  async successfulCompanyResponse(runId: string) {
    return (await this.database.select().from(firmableCompanyResponses).where(and(eq(firmableCompanyResponses.runId, runId), eq(firmableCompanyResponses.successful, true), isNotNull(firmableCompanyResponses.response))).orderBy(desc(firmableCompanyResponses.fetchedAt), desc(firmableCompanyResponses.id)).limit(1))[0];
  }

  async successfulSearchPage(runId: string, offset: number) {
    return (await this.database.select().from(firmablePeopleSearches).where(and(eq(firmablePeopleSearches.runId, runId), eq(firmablePeopleSearches.offset, offset), eq(firmablePeopleSearches.successful, true), isNotNull(firmablePeopleSearches.response))).orderBy(desc(firmablePeopleSearches.fetchedAt), desc(firmablePeopleSearches.id)).limit(1))[0];
  }

  async searchCandidates(runId: string, beforeOffset?: number) {
    const pages = await this.database.select().from(firmablePeopleSearches).where(and(eq(firmablePeopleSearches.runId, runId), eq(firmablePeopleSearches.successful, true), isNotNull(firmablePeopleSearches.response), beforeOffset === undefined ? undefined : lt(firmablePeopleSearches.offset, beforeOffset))).orderBy(asc(firmablePeopleSearches.offset), asc(firmablePeopleSearches.fetchedAt));
    const candidates = new Map<string, PersonCandidate>();
    const reportedTotals = new Set<number>();
    let malformedCount = 0;
    for (const page of pages) {
      if (page.reportedTotal !== null) reportedTotals.add(page.reportedTotal);
      const payload = object(page.response);
      const records = Array.isArray(page.response) ? page.response : Array.isArray(payload?.records) ? payload.records : Array.isArray(payload?.data) ? payload.data : [];
      for (const value of records) {
        const candidate = mapFirmableCandidate(object(value) || {});
        if (candidate) candidates.set(candidate.id, candidate);
        else malformedCount++;
      }
    }
    const [reportedTotal] = [...reportedTotals];
    return { candidates: [...candidates.values()], reportedTotal, reportedTotals: [...reportedTotals], malformedCount, pages };
  }

  async successfulPersonResponse(runId: string, personId: string) {
    return (await this.database.select().from(firmablePersonResponses).where(and(eq(firmablePersonResponses.runId, runId), eq(firmablePersonResponses.firmablePersonId, personId), eq(firmablePersonResponses.successful, true))).orderBy(desc(firmablePersonResponses.fetchedAt), desc(firmablePersonResponses.id)).limit(1))[0];
  }

  async profileProgress(runId: string, candidateIds: string[]) {
    if (!candidateIds.length) return { found: 0, saved: 0, failed: 0, attempted: 0, pending: 0 };
    const attempts = await this.database.select({ personId: firmablePersonResponses.firmablePersonId, successful: firmablePersonResponses.successful }).from(firmablePersonResponses).where(and(eq(firmablePersonResponses.runId, runId), inArray(firmablePersonResponses.firmablePersonId, candidateIds)));
    const saved = new Set(attempts.filter(attempt => attempt.successful && attempt.personId).map(attempt => attempt.personId!));
    const attempted = new Set(attempts.filter(attempt => attempt.personId).map(attempt => attempt.personId!));
    return { found: candidateIds.length, saved: saved.size, failed: [...attempted].filter(id => !saved.has(id)).length, attempted: attempted.size, pending: candidateIds.filter(id => !attempted.has(id)).length };
  }

  async recordObservation(runId: string, observation: FirmableHttpObservation, options: { retainPersonalData: boolean }) {
    const payload = object(observation.response);
    const httpOk = observation.httpStatus !== undefined && observation.httpStatus >= 200 && observation.httpStatus < 300;
    const schemaValid = observation.endpoint === "/company"
      ? Boolean(text(payload?.id))
      : observation.endpoint === "/people"
        ? Boolean(text(payload?.id))
        : observation.endpoint === "/people/search"
          ? Array.isArray(observation.response) || isEmptyFirmablePeopleSearchResponse(observation.response) || (payload?.success !== false && (Array.isArray(payload?.records) || Array.isArray(payload?.data)))
          : Boolean(payload);
    const httpSuccessful = httpOk && schemaValid;
    const common = {
      runId,
      logicalCallId: observation.logicalCallId,
      attempt: observation.attempt,
      request: observation.request,
      responseText: observation.responseText,
      httpStatus: observation.httpStatus,
      successful: httpSuccessful,
      validationError: observation.error || (!httpOk && observation.httpStatus ? `Company data request failed (${observation.httpStatus})` : httpOk && !schemaValid ? "Company data response failed validation" : undefined),
      requestedAt: observation.requestedAt,
      fetchedAt: observation.fetchedAt,
    };

    if (observation.endpoint === "/company") {
      const companyId = text(payload?.id);
      if (companyId) {
        const codes = object(payload?.industry_codes);
        if (httpSuccessful) await this.database.insert(firmableCompanies).values({ id: companyId, name: text(payload?.name), domain: normalizeFirmableDomain(text(payload?.fqdn) || text(payload?.website)), abn: normalizeFirmableAbn(text(codes?.abn)), acn: text(codes?.acn) }).onConflictDoUpdate({ target: firmableCompanies.id, set: { name: text(payload?.name), domain: normalizeFirmableDomain(text(payload?.fqdn) || text(payload?.website)), abn: normalizeFirmableAbn(text(codes?.abn)), acn: text(codes?.acn), updatedAt: new Date() } });
        else await this.database.insert(firmableCompanies).values({ id: companyId }).onConflictDoNothing();
      }
      const [recorded] = await this.database.insert(firmableCompanyResponses).values({ ...common, firmableCompanyId: companyId, response: payload, responseHash: payload ? responseHash(payload) : undefined }).onConflictDoNothing().returning({ id: firmableCompanyResponses.id });
      if (recorded && companyId && httpSuccessful) await this.linkRunCompany(runId, companyId, "complete");
      return;
    }

    const requestBody = object(observation.request.body);
    if (observation.endpoint === "/people/search") {
      const companyId = text(requestBody?.companyId);
      const records = Array.isArray(observation.response) ? observation.response : Array.isArray(payload?.records) ? payload.records : Array.isArray(payload?.data) ? payload.data : [];
      const storedResponse = options.retainPersonalData ? observation.response : { success: httpSuccessful, total: number(payload?.total), records: records.map(record => { const item = object(record) || {}; return { person_id: text(item.person_id) || text(item.id), position: text(item.position) || text(item.title), seniority: text(item.seniority), department: text(item.department), has_email: Boolean(item.has_email || item.email_available), has_phone: Boolean(item.has_phone || item.phone_available) }; }) };
      await this.database.insert(firmablePeopleSearches).values({ ...common, firmableCompanyId: companyId, response: storedResponse, responseHash: responseHash(storedResponse), offset: Number(text(requestBody?.from) || 0), requestedSize: Number(text(requestBody?.size) || 0), returnedCount: records.length, reportedTotal: number(payload?.total) ?? (isEmptyFirmablePeopleSearchResponse(observation.response) ? 0 : undefined) }).onConflictDoNothing();
      return;
    }

    if (observation.endpoint === "/people") {
      const requestQuery = object(observation.request.query);
      const personId = text(payload?.id) || text(requestQuery?.id);
      if (personId) await this.database.insert(firmablePeople).values({ id: personId, name: text(payload?.name) || text(payload?.full_name), linkedin: text(payload?.linkedin) || text(payload?.linkedin_url) }).onConflictDoUpdate({ target: firmablePeople.id, set: { name: text(payload?.name) || text(payload?.full_name), linkedin: text(payload?.linkedin) || text(payload?.linkedin_url), updatedAt: new Date() } });
      const retained = options.retainPersonalData ? payload : undefined;
      await this.database.insert(firmablePersonResponses).values({ ...common, firmablePersonId: personId, response: retained, responseHash: retained ? responseHash(retained) : undefined, privacyMode: options.retainPersonalData ? "real" : "redacted" }).onConflictDoNothing();
    }
  }

  async reconcilePeople(runId: string, companyId: string, candidates: PersonCandidate[], complete: boolean, retainPersonalData = process.env.ALLOW_REAL_PERSONAL_DATA === "true") {
    const [run] = await this.database.select({ generation: firmableSyncRuns.generation }).from(firmableSyncRuns).where(eq(firmableSyncRuns.id, runId)).limit(1);
    const [current] = await this.database.select({ generation: max(firmableCompanyPeople.generation) }).from(firmableCompanyPeople).where(eq(firmableCompanyPeople.firmableCompanyId, companyId));
    if (run && current?.generation && run.generation < current.generation) return;
    const [search] = await this.database.select({ id: firmablePeopleSearches.id }).from(firmablePeopleSearches).where(and(eq(firmablePeopleSearches.runId, runId), eq(firmablePeopleSearches.successful, true))).orderBy(desc(firmablePeopleSearches.fetchedAt), desc(firmablePeopleSearches.id)).limit(1);
    const seenAt = new Date();
    for (const candidate of candidates) {
      await this.database.insert(firmablePeople).values({ id: candidate.id }).onConflictDoNothing();
      const searchRecord = retainPersonalData ? candidate.rawResponse || {} : { person_id: candidate.id, position: candidate.position, seniority: candidate.seniority, department: candidate.department, has_email: candidate.emailAvailable, has_phone: candidate.phoneAvailable };
      const generation = run?.generation || 1;
      await this.database.insert(firmableCompanyPeople).values({ firmableCompanyId: companyId, firmablePersonId: candidate.id, latestSearchId: search?.id, searchRecord, generation, firstSeenAt: seenAt, lastSeenAt: seenAt }).onConflictDoUpdate({ target: [firmableCompanyPeople.firmableCompanyId, firmableCompanyPeople.firmablePersonId], set: { latestSearchId: search?.id, searchRecord, generation, active: true, lastSeenAt: seenAt, updatedAt: seenAt }, setWhere: lte(firmableCompanyPeople.generation, generation) });
    }
    if (complete) {
      const ids = candidates.map(candidate => candidate.id);
      await this.database.update(firmableCompanyPeople).set({ active: false, updatedAt: seenAt }).where(and(eq(firmableCompanyPeople.firmableCompanyId, companyId), lte(firmableCompanyPeople.generation, run?.generation || 1), ids.length ? notInArray(firmableCompanyPeople.firmablePersonId, ids) : undefined));
    }
  }

  async completePeopleReconciliation(runId: string, companyId: string, personIds: string[]) {
    const [run] = await this.database.select({ generation: firmableSyncRuns.generation }).from(firmableSyncRuns).where(eq(firmableSyncRuns.id, runId)).limit(1);
    if (!run) throw new Error("Company data refresh not found");
    await this.database.update(firmableCompanyPeople).set({ active: false, updatedAt: new Date() }).where(and(
      eq(firmableCompanyPeople.firmableCompanyId, companyId),
      lte(firmableCompanyPeople.generation, run.generation),
      personIds.length ? notInArray(firmableCompanyPeople.firmablePersonId, personIds) : undefined,
    ));
  }

  async finishRun(runId: string, result: { found: number; saved: number; failed: number; searchComplete?: boolean; message?: string; partial?: boolean }) {
    const partial = result.partial === true || result.failed > 0 || result.searchComplete === false;
    await this.database.update(firmableSyncRuns).set({ status: partial ? "partial" : "complete", searchStatus: result.searchComplete === false ? "incomplete" : "complete", profilesFound: result.found, profilesSaved: result.saved, profilesFailed: result.failed, message: result.message || (partial ? "Company data refresh completed with partial results" : "Company data refresh complete"), completedAt: new Date(), updatedAt: new Date() }).where(and(eq(firmableSyncRuns.id, runId), inArray(firmableSyncRuns.status, ["queued", "running"])));
  }

  async failRun(runId: string, message: string) {
    await this.database.update(firmableSyncRuns).set({ status: "failed", message, error: { message }, completedAt: new Date(), updatedAt: new Date() }).where(and(eq(firmableSyncRuns.id, runId), inArray(firmableSyncRuns.status, ["queued", "running"])));
  }

  async findCompany(input: { firmableId?: string; domain?: string | null; abn?: string | null }) {
    const domain = normalizeFirmableDomain(input.domain);
    const abn = normalizeFirmableAbn(input.abn);
    const conditions = [input.firmableId ? eq(firmableCompanies.id, input.firmableId) : undefined, abn ? eq(firmableCompanies.abn, abn) : undefined, domain ? eq(firmableCompanies.domain, domain) : undefined].filter(Boolean);
    if (!conditions.length) return undefined;
    const rows = await this.database.select().from(firmableCompanies).where(or(...conditions as Parameters<typeof or>)).limit(2);
    return rows.length === 1 ? rows[0] : undefined;
  }

  async latestCompanyResponses(companyIds: string[]) {
    if (!companyIds.length) return new Map<string, { response: Record<string, unknown>; fetchedAt: Date }>();
    const rows = await this.database.selectDistinctOn([firmableCompanyResponses.firmableCompanyId], { firmableCompanyId: firmableCompanyResponses.firmableCompanyId, response: firmableCompanyResponses.response, fetchedAt: firmableCompanyResponses.fetchedAt }).from(firmableCompanyResponses).where(and(inArray(firmableCompanyResponses.firmableCompanyId, companyIds), eq(firmableCompanyResponses.successful, true), isNotNull(firmableCompanyResponses.response))).orderBy(firmableCompanyResponses.firmableCompanyId, desc(firmableCompanyResponses.fetchedAt), desc(firmableCompanyResponses.id));
    const latest = new Map<string, { response: Record<string, unknown>; fetchedAt: Date }>();
    for (const row of rows) if (row.firmableCompanyId && !latest.has(row.firmableCompanyId) && object(row.response)) latest.set(row.firmableCompanyId, { response: object(row.response)!, fetchedAt: row.fetchedAt });
    return latest;
  }

  async latestPeople(companyIds: string[]) {
    if (!companyIds.length) return new Map<string, StoredFirmablePerson[]>();
    const links = await this.database.select().from(firmableCompanyPeople).where(and(inArray(firmableCompanyPeople.firmableCompanyId, companyIds), eq(firmableCompanyPeople.active, true)));
    const personIds = [...new Set(links.map(link => link.firmablePersonId))];
    const allowRealPersonalData = process.env.ALLOW_REAL_PERSONAL_DATA === "true";
    const profiles = allowRealPersonalData && personIds.length ? await this.database.selectDistinctOn([firmablePersonResponses.firmablePersonId], { firmablePersonId: firmablePersonResponses.firmablePersonId, response: firmablePersonResponses.response, fetchedAt: firmablePersonResponses.fetchedAt }).from(firmablePersonResponses).where(and(inArray(firmablePersonResponses.firmablePersonId, personIds), eq(firmablePersonResponses.successful, true), eq(firmablePersonResponses.privacyMode, "real"), isNotNull(firmablePersonResponses.response))).orderBy(firmablePersonResponses.firmablePersonId, desc(firmablePersonResponses.fetchedAt), desc(firmablePersonResponses.id)) : [];
    const latestProfiles = new Map<string, { response: Record<string, unknown>; fetchedAt: Date }>();
    for (const profile of profiles) if (profile.firmablePersonId && !latestProfiles.has(profile.firmablePersonId) && object(profile.response)) latestProfiles.set(profile.firmablePersonId, { response: object(profile.response)!, fetchedAt: profile.fetchedAt });
    const result = new Map<string, StoredFirmablePerson[]>();
    for (const link of links) {
      const current = result.get(link.firmableCompanyId) || [];
      const profile = latestProfiles.get(link.firmablePersonId);
      const rawSearch = object(link.searchRecord) || {};
      const searchRecord = allowRealPersonalData ? rawSearch : { person_id: link.firmablePersonId, position: rawSearch.position, seniority: rawSearch.seniority, department: rawSearch.department, has_email: rawSearch.has_email, has_phone: rawSearch.has_phone };
      current.push({ companyId: link.firmableCompanyId, personId: link.firmablePersonId, searchRecord, profile: profile?.response, fetchedAt: profile?.fetchedAt });
      result.set(link.firmableCompanyId, current);
    }
    return result;
  }
}
