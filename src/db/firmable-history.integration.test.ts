import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { Client, Pool } from "pg";

vi.mock("./client", () => ({ requireDb: vi.fn() }));

import type { FirmableHttpObservation } from "@/adapters/firmable-client";
import { FirmableHistoryRepository } from "./firmable-history-repository";
import { upsertFirmableContact } from "./firmable-contacts";
import { OrganizationRepository } from "./repositories";
import { contacts, firmableCompanies, firmablePeople, organization, targets, user } from "./schema";
import * as schema from "./schema";

const enabled = process.env.RUN_FIRMABLE_DB_INTEGRATION === "true";
const integrationUrl = process.env.FIRMABLE_INTEGRATION_DATABASE_URL;

describe.skipIf(!enabled)("Firmable history PostgreSQL integration", () => {
  let client: Client;
  let repository: FirmableHistoryRepository;
  let actorId: string;
  let organizationId: string;
  let otherOrganizationId: string;
  let targetId: string;
  let otherTargetId: string;

  beforeAll(async () => {
    if (!integrationUrl) throw new Error("FIRMABLE_INTEGRATION_DATABASE_URL is required when RUN_FIRMABLE_DB_INTEGRATION=true");

    client = new Client({ connectionString: integrationUrl });
    await client.connect();
    await client.query("begin");

    const database = drizzle({ client, schema });
    repository = new FirmableHistoryRepository(database);
    const suffix = crypto.randomUUID();
    actorId = `firmable-integration-user-${suffix}`;
    organizationId = `firmable-integration-org-a-${suffix}`;
    otherOrganizationId = `firmable-integration-org-b-${suffix}`;

    await database.insert(user).values({ id: actorId, name: "Firmable integration", email: `${suffix}@firmable.integration.test` });
    await database.insert(organization).values([
      { id: organizationId, name: "Firmable integration A", slug: `firmable-integration-a-${suffix}` },
      { id: otherOrganizationId, name: "Firmable integration B", slug: `firmable-integration-b-${suffix}` },
    ]);
    const insertedTargets = await database.insert(targets).values([
      { organizationId, companyName: "Shared Example", domain: "www.shared-example.test", firmographics: {} },
      { organizationId: otherOrganizationId, companyName: "Shared Example Again", domain: "https://shared-example.test/path", firmographics: {} },
    ]).returning({ id: targets.id });
    targetId = insertedTargets[0].id;
    otherTargetId = insertedTargets[1].id;
  });

  afterAll(async () => {
    if (!client) return;
    await client.query("rollback");
    await client.end();
  });

  it("keeps every observation, shares the company across organisations, and reads the latest successful payload", async () => {
    const companyId = `firmable-company-${crypto.randomUUID()}`;
    const response = { id: companyId, name: "Shared Example Pty Ltd", fqdn: "shared-example.test", industry_codes: { abn: "12 345 678 901" } };
    const run = await repository.startRun({ organizationId, actorId, targetId, requestKey: crypto.randomUUID() });

    await repository.recordObservation(run.id, observation("company-success-1", "/company", response, 200, new Date("2026-09-17T00:00:00Z")), { retainPersonalData: true });
    await repository.recordObservation(run.id, observation("company-success-2", "/company", response, 200, new Date("2026-09-17T00:01:00Z")), { retainPersonalData: true });
    await repository.recordObservation(run.id, observation("company-failure", "/company", { ...response, name: "Do not project this failure" }, 503, new Date("2026-09-17T00:02:00Z")), { retainPersonalData: true });

    const result = await client.query<{ count: string; distinct_hashes: string }>(
      "select count(*)::text as count, count(distinct response_hash)::text as distinct_hashes from firmable_company_responses where run_id = $1",
      [run.id],
    );
    expect(result.rows[0]).toEqual({ count: "3", distinct_hashes: "2" });

    const latest = await repository.latestCompanyResponses([companyId]);
    expect(latest.get(companyId)?.response).toEqual(response);
    expect((await repository.findCompany({ domain: "https://www.shared-example.test/a" }))?.id).toBe(companyId);
    expect((await repository.findCompany({ abn: "12345678901" }))?.id).toBe(companyId);

    const secondRun = await repository.startRun({ organizationId: otherOrganizationId, actorId, targetId: otherTargetId, requestKey: crypto.randomUUID() });
    await repository.recordObservation(secondRun.id, observation("company-other-org", "/company", response, 200, new Date("2026-09-17T00:03:00Z")), { retainPersonalData: true });
    const targetLinks = await client.query<{ organization_id: string; firmable_company_id: string }>(
      "select organization_id, firmable_company_id from targets where id = any($1::uuid[]) order by organization_id",
      [[targetId, otherTargetId]],
    );
    expect(targetLinks.rows).toHaveLength(2);
    expect(new Set(targetLinks.rows.map(row => row.firmable_company_id))).toEqual(new Set([companyId]));
    await repository.finishRun(run.id, { found: 0, saved: 0, failed: 0 });
    await repository.finishRun(secondRun.id, { found: 0, saved: 0, failed: 0 });
  });

  it("stores search and profile history, projects the latest profile, and deactivates absent people only after a complete search", async () => {
    const companyId = `firmable-company-${crypto.randomUUID()}`;
    const personId = `firmable-person-${crypto.randomUUID()}`;
    const removedPersonId = `firmable-person-${crypto.randomUUID()}`;
    const run = await repository.startRun({ organizationId, actorId, targetId, requestKey: crypto.randomUUID() });
    await repository.recordObservation(run.id, observation("people-company", "/company", { id: companyId, name: "People Example", fqdn: "people-example.test" }, 200), { retainPersonalData: true });
    await repository.recordObservation(run.id, observation("people-search", "/people/search", { records: [{ id: personId, position: "Owner" }, { id: removedPersonId, position: "Director" }], success: true, total: 2 }, 200, undefined, { companyId, from: "0", size: "100" }), { retainPersonalData: true });
    await repository.recordObservation(run.id, observation("people-profile", "/people", { id: personId, full_name: "Alex Example", position: "Owner", emails: { work: [{ value: "alex@example.test" }] } }, 200, undefined, undefined, { id: personId }), { retainPersonalData: true });
    await repository.reconcilePeople(run.id, companyId, [
      { id: personId, position: "Owner", emailAvailable: true, phoneAvailable: false, rawResponse: { id: personId, position: "Owner" } },
      { id: removedPersonId, position: "Director", emailAvailable: false, phoneAvailable: false, rawResponse: { id: removedPersonId, position: "Director" } },
    ], true, true);

    const previousPrivacySetting = process.env.ALLOW_REAL_PERSONAL_DATA;
    process.env.ALLOW_REAL_PERSONAL_DATA = "true";
    try {
      const people = await repository.latestPeople([companyId]);
      expect(people.get(companyId)).toEqual(expect.arrayContaining([
        expect.objectContaining({ personId, profile: expect.objectContaining({ full_name: "Alex Example" }) }),
        expect.objectContaining({ personId: removedPersonId, profile: undefined }),
      ]));
    } finally {
      if (previousPrivacySetting === undefined) delete process.env.ALLOW_REAL_PERSONAL_DATA;
      else process.env.ALLOW_REAL_PERSONAL_DATA = previousPrivacySetting;
    }

    await repository.reconcilePeople(run.id, companyId, [{ id: personId, position: "Owner", emailAvailable: true, phoneAvailable: false }], false, true);
    expect(await activePersonIds(client, companyId)).toEqual([personId, removedPersonId].sort());

    await repository.reconcilePeople(run.id, companyId, [{ id: personId, position: "Owner", emailAvailable: true, phoneAvailable: false }], true, true);
    expect(await activePersonIds(client, companyId)).toEqual([personId]);
    await repository.finishRun(run.id, { found: 2, saved: 1, failed: 1 });
  });

  it("deduplicates active queued work and reconstructs durable page and profile progress", async () => {
    const queuedTargetId = crypto.randomUUID();
    await client.query("insert into targets (id, organization_id, company_name, domain, firmographics) values ($1, $2, $3, $4, $5::jsonb)", [queuedTargetId, organizationId, "Queued Example", "queued.example", "{}"]);
    const first = await repository.queueRun({ organizationId, actorId, targetId: queuedTargetId, requestKey: crypto.randomUUID() });
    const duplicate = await repository.queueRun({ organizationId, actorId, targetId: queuedTargetId, requestKey: crypto.randomUUID() });
    expect(duplicate.id).toBe(first.id);
    expect(first.status).toBe("queued");

    const companyId = `firmable-company-${crypto.randomUUID()}`;
    const firstPerson = `firmable-person-${crypto.randomUUID()}`;
    const secondPerson = `firmable-person-${crypto.randomUUID()}`;
    await repository.markRunning(first.id);
    await repository.recordObservation(first.id, observation("queued-company", "/company", { id: companyId, name: "Queued Example" }, 200), { retainPersonalData: true });
    await repository.recordObservation(first.id, observation("queued-search-0", "/people/search", { records: [{ person_id: firstPerson, position: "Owner" }], success: true, total: 2 }, 200, undefined, { companyId, from: "0", size: "1" }), { retainPersonalData: true });
    await repository.recordObservation(first.id, observation("queued-search-1", "/people/search", { records: [{ person_id: secondPerson, position: "Director" }], success: true, total: 2 }, 200, undefined, { companyId, from: "1", size: "1" }), { retainPersonalData: true });
    await repository.recordObservation(first.id, observation("queued-profile-ok", "/people", { id: firstPerson, name: "First Person" }, 200, undefined, undefined, { id: firstPerson }), { retainPersonalData: true });
    await repository.recordObservation(first.id, observation("queued-profile-failed", "/people", { error: "Unavailable" }, 500, undefined, undefined, { id: secondPerson }), { retainPersonalData: true });

    expect((await repository.successfulSearchPage(first.id, 0))?.returnedCount).toBe(1);
    expect((await repository.searchCandidates(first.id)).candidates.map(candidate => candidate.id)).toEqual([firstPerson, secondPerson]);
    expect(await repository.profileProgress(first.id, [firstPerson, secondPerson])).toEqual({ found: 2, saved: 1, failed: 1, attempted: 2, pending: 0 });

    await repository.finishRun(first.id, { found: 2, saved: 1, failed: 1, searchComplete: true });
    const next = await repository.queueRun({ organizationId, actorId, targetId: queuedTargetId, requestKey: crypto.randomUUID() });
    expect(next.id).not.toBe(first.id);
  });

  it("prevents an older target generation from restoring stale people", async () => {
    const concurrentTargetId = crypto.randomUUID();
    await client.query("insert into targets (id, organization_id, company_name, domain, firmographics) values ($1, $2, $3, $4, $5::jsonb)", [concurrentTargetId, organizationId, "Concurrent Example", "concurrent.example", "{}"]);
    const older = await repository.queueRun({ organizationId, actorId, targetId: concurrentTargetId, requestKey: crypto.randomUUID() });

    const companyId = `firmable-company-${crypto.randomUUID()}`;
    const stalePerson = `firmable-person-${crypto.randomUUID()}`;
    const currentPerson = `firmable-person-${crypto.randomUUID()}`;
    await repository.recordObservation(older.id, observation("concurrent-company-old", "/company", { id: companyId, name: "Concurrent Example" }, 200), { retainPersonalData: true });
    await repository.finishRun(older.id, { found: 0, saved: 0, failed: 0 });
    const newer = await repository.queueRun({ organizationId, actorId, targetId: concurrentTargetId, requestKey: crypto.randomUUID() });
    expect(newer.generation).toBeGreaterThan(older.generation);
    await repository.recordObservation(newer.id, observation("concurrent-company-new", "/company", { id: companyId, name: "Concurrent Example" }, 200), { retainPersonalData: true });
    await repository.reconcilePeople(newer.id, companyId, [{ id: currentPerson, position: "Owner", emailAvailable: true, phoneAvailable: false }], true, true);
    await repository.reconcilePeople(older.id, companyId, [{ id: stalePerson, position: "Former owner", emailAvailable: false, phoneAvailable: false }], true, true);
    expect(await activePersonIds(client, companyId)).toEqual([currentPerson]);
    await repository.finishRun(older.id, { found: 1, saved: 0, failed: 1 });
    await repository.finishRun(newer.id, { found: 1, saved: 0, failed: 1 });
  });

  it("orders relationship reconciliation globally across organisations", async () => {
    const companyId = `firmable-company-${crypto.randomUUID()}`;
    const stalePerson = `firmable-person-${crypto.randomUUID()}`;
    const currentPerson = `firmable-person-${crypto.randomUUID()}`;
    const older = await repository.startRun({ organizationId, actorId, targetId, requestKey: crypto.randomUUID() });
    await repository.recordObservation(older.id, observation("cross-org-company-old", "/company", { id: companyId, name: "Cross-org Example" }, 200), { retainPersonalData: true });
    const newer = await repository.startRun({ organizationId: otherOrganizationId, actorId, targetId: otherTargetId, requestKey: crypto.randomUUID() });
    await repository.recordObservation(newer.id, observation("cross-org-company-new", "/company", { id: companyId, name: "Cross-org Example" }, 200), { retainPersonalData: true });
    expect(newer.generation).toBe(1);
    expect((await repository.run(newer.id))?.generation).toBeGreaterThan((await repository.run(older.id))!.generation);
    await repository.reconcilePeople(newer.id, companyId, [{ id: currentPerson, position: "Owner", emailAvailable: true, phoneAvailable: false }], true, true);
    await repository.reconcilePeople(older.id, companyId, [{ id: stalePerson, position: "Former owner", emailAvailable: false, phoneAvailable: false }], true, true);
    expect(await activePersonIds(client, companyId)).toEqual([currentPerson]);
    await repository.finishRun(older.id, { found: 1, saved: 0, failed: 1 });
    await repository.finishRun(newer.id, { found: 1, saved: 0, failed: 1 });
  });

  it("materializes one contact under concurrent Firmable upserts and preserves local DND", async () => {
    const companyId = `firmable-company-${crypto.randomUUID()}`;
    const personId = `firmable-person-${crypto.randomUUID()}`;
    await client.query("insert into firmable_companies (id, name) values ($1, $2)", [companyId, "Contact Example"]);
    await client.query("insert into firmable_people (id, name) values ($1, $2)", [personId, "Contact Owner"]);
    for (let attempt = 0; attempt < 8; attempt++) await upsertFirmableContact({
      database: repository["database"], organizationId, targetId, companyId,
      person: { id: personId, name: "Contact Owner", position: "Owner", email: "owner@example.test", emailAvailable: true, phoneAvailable: false, fictionalised: false, doNotContact: false },
    });
    const [saved] = await repository["database"].select().from(contacts).where(and(eq(contacts.organizationId, organizationId), eq(contacts.targetId, targetId), eq(contacts.firmablePersonId, personId)));
    await repository["database"].update(contacts).set({ personalData: { ...(saved.personalData as Record<string, unknown>), doNotContact: true } }).where(eq(contacts.id, saved.id));
    await upsertFirmableContact({ database: repository["database"], organizationId, targetId, companyId, person: { id: personId, name: "Updated Owner", position: "Managing Director", email: "updated@example.test", emailAvailable: true, phoneAvailable: false, fictionalised: false, doNotContact: false } });
    const rows = await repository["database"].select().from(contacts).where(and(eq(contacts.organizationId, organizationId), eq(contacts.targetId, targetId), eq(contacts.firmablePersonId, personId)));
    expect(rows).toHaveLength(1);
    expect(rows[0].displayName).toBe("Updated Owner");
    expect((rows[0].personalData as Record<string, unknown>).doNotContact).toBe(true);
  });

  it("updates Firmable facts without changing an existing workflow status", async () => {
    const companyId = `firmable-company-${crypto.randomUUID()}`;
    await client.query("insert into firmable_companies (id, name) values ($1, $2)", [companyId, "Status Example"]);
    await client.query("update targets set status = 'contacted' where id = $1", [targetId]);
    const provenance = { source: "Firmable", capturedAt: new Date().toISOString(), confidence: 1 };
    const saved = await new OrganizationRepository(repository["database"], organizationId).upsertEnrichedTarget({
      existingTargetId: targetId,
      mandateId: crypto.randomUUID(),
      actorId,
      target: {
        id: targetId, organisationId: organizationId, companyName: "Updated Status Example", domain: "status.example", suburb: "Melbourne", state: "VIC", status: "enriched", signals: [],
        sector: { value: "Manufacturing", provenance }, revenue: { value: null, provenance }, ebitda: { value: null, provenance }, headcount: { value: 25, provenance }, establishedYear: { value: null, provenance },
        sourceData: { firmable: { firmableId: companyId, industries: ["Manufacturing"], keywords: [], states: ["VIC"], locations: ["Melbourne"] } },
        scores: { fit: 80, ripeness: 60, financeability: null, confidence: 70, band: "warm", qualification: "develop", tensions: [], reasons: [] },
      },
    });
    expect(saved?.id).toBe(targetId);
    const row = await client.query<{ status: string; company_name: string }>("select status, company_name from targets where id = $1", [targetId]);
    expect(row.rows[0]).toEqual({ status: "contacted", company_name: "Updated Status Example" });
  });

  it("has the approved concurrency guards installed", async () => {
    const indexes = await client.query<{ indexname: string }>("select indexname from pg_indexes where schemaname = 'public' and indexname = any($1::text[]) order by indexname", [["contacts_target_firmable_person_unique_idx", "firmable_sync_runs_active_target_unique_idx"]]);
    expect(indexes.rows.map(row => row.indexname)).toEqual(["contacts_target_firmable_person_unique_idx", "firmable_sync_runs_active_target_unique_idx"]);
    const column = await client.query<{ column_default: string }>("select column_default from information_schema.columns where table_schema = 'public' and table_name = 'firmable_companies' and column_name = 'people_generation'");
    expect(column.rows[0]?.column_default).toBe("0");
  });

  it("enforces run and contact uniqueness across pooled database connections", async () => {
    const pool = new Pool({ connectionString: integrationUrl, max: 12 });
    const database = drizzle({ client: pool, schema });
    const suffix = crypto.randomUUID();
    const pooledActorId = `firmable-pool-user-${suffix}`;
    const pooledOrganizationId = `firmable-pool-org-${suffix}`;
    const pooledTargetId = crypto.randomUUID();
    const companyId = `firmable-pool-company-${suffix}`;
    const personId = `firmable-pool-person-${suffix}`;
    try {
      await database.insert(user).values({ id: pooledActorId, name: "Firmable pool integration", email: `${suffix}@firmable.pool.test` });
      await database.insert(organization).values({ id: pooledOrganizationId, name: "Firmable pool integration", slug: `firmable-pool-${suffix}` });
      await database.insert(targets).values({ id: pooledTargetId, organizationId: pooledOrganizationId, companyName: "Pool Example", domain: "pool.example", firmographics: {} });
      const pooledRepository = new FirmableHistoryRepository(database);
      const runs = await Promise.all(Array.from({ length: 12 }, () => pooledRepository.queueRun({ organizationId: pooledOrganizationId, actorId: pooledActorId, targetId: pooledTargetId, requestKey: crypto.randomUUID() })));
      expect(new Set(runs.map(run => run.id)).size).toBe(1);

      await database.insert(firmableCompanies).values({ id: companyId, name: "Pool Example" });
      await database.insert(firmablePeople).values({ id: personId, name: "Pool Owner" });
      await Promise.all(Array.from({ length: 12 }, () => upsertFirmableContact({ database, organizationId: pooledOrganizationId, targetId: pooledTargetId, companyId, person: { id: personId, name: "Pool Owner", position: "Owner", email: "pool@example.test", emailAvailable: true, phoneAvailable: false, fictionalised: false, doNotContact: false } })));
      expect(await database.$count(contacts, and(eq(contacts.organizationId, pooledOrganizationId), eq(contacts.targetId, pooledTargetId), eq(contacts.firmablePersonId, personId)))).toBe(1);
    } finally {
      await database.delete(targets).where(eq(targets.id, pooledTargetId));
      await database.delete(firmablePeople).where(eq(firmablePeople.id, personId));
      await database.delete(firmableCompanies).where(eq(firmableCompanies.id, companyId));
      await database.delete(organization).where(eq(organization.id, pooledOrganizationId));
      await database.delete(user).where(eq(user.id, pooledActorId));
      await pool.end();
    }
  });

  it("can repeat the approved legacy backfill without duplicating history", async () => {
    const tables = ["firmable_companies", "firmable_company_responses", "firmable_people", "firmable_people_searches", "firmable_person_responses", "firmable_company_people"];
    const migration = readFileSync(new URL("../../drizzle/0006_firmable_history.sql", import.meta.url), "utf8");
    const backfill = migration.slice(migration.indexOf("-- Backfill shared company identities"));
    for (const statement of backfill.split("--> statement-breakpoint").map(value => value.trim()).filter(Boolean)) await client.query(statement);
    const afterFirst = await tableCounts(client, tables);
    for (const statement of backfill.split("--> statement-breakpoint").map(value => value.trim()).filter(Boolean)) await client.query(statement);
    expect(await tableCounts(client, tables)).toEqual(afterFirst);
  });
});

function observation(
  logicalCallId: string,
  endpoint: string,
  response: unknown,
  httpStatus: number,
  fetchedAt = new Date(),
  body?: Record<string, unknown>,
  query?: Record<string, unknown>,
): FirmableHttpObservation {
  return { logicalCallId, attempt: 1, endpoint, method: endpoint === "/people/search" ? "POST" : "GET", request: { ...(body ? { body } : {}), ...(query ? { query } : {}) }, response, httpStatus, requestedAt: fetchedAt, fetchedAt };
}

async function activePersonIds(client: Client, companyId: string) {
  const result = await client.query<{ firmable_person_id: string }>("select firmable_person_id from firmable_company_people where firmable_company_id = $1 and active = true order by firmable_person_id", [companyId]);
  return result.rows.map(row => row.firmable_person_id);
}

async function tableCounts(client: Client, tables: string[]) {
  const counts: Record<string, number> = {};
  for (const table of tables) {
    if (!/^firmable_[a-z_]+$/.test(table)) throw new Error(`Unsafe integration table name: ${table}`);
    const result = await client.query<{ count: string }>(`select count(*)::text as count from ${table}`);
    counts[table] = Number(result.rows[0].count);
  }
  return counts;
}
