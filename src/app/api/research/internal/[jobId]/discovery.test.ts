import { PgDialect } from "drizzle-orm/pg-core";
import { sql, type SQL } from "drizzle-orm";
import { Client } from "pg";
import { beforeEach, expect, it, vi } from "vitest";
import type { ResearchConfig } from "@/domain/research";
const mocks = vi.hoisted(() => ({ get: vi.fn(), list: vi.fn(), runJobs: vi.fn(), seeds: vi.fn(), search: vi.fn(), set: vi.fn(), where: vi.fn(), claim: vi.fn(), dispatch: vi.fn() }));
vi.mock("@/lib/research-service", () => ({ researchEnabled: () => true, researchServiceAuthorized: () => true }));
vi.mock("@/lib/research-scheduler", () => ({ scheduleResearchRun: mocks.dispatch }));
vi.mock("@/lib/automatic-discovery", () => ({ dispatchDiscoveryCandidates: mocks.dispatch }));
vi.mock("@/lib/automatic-enrichment", () => ({ dispatchAutomaticEnrichment: vi.fn() }));
vi.mock("@/lib/research-continuation", () => ({ dispatchContinuation: vi.fn() }));
vi.mock("@/adapters/cloudflare-web-search", () => ({ cloudflareSearchResults: mocks.search }));
vi.mock("@/db/research-repository", () => ({ researchExecutionSelection: {}, ResearchRepository: class { get = mocks.get; getExecution = mocks.get; getControl = mocks.get; list = mocks.list; discoveryRunJobs = mocks.runJobs; seeds = mocks.seeds; } }));
vi.mock("@/db/client", () => ({ requireDb: () => ({
  select: () => ({ from: () => ({ where: () => ({ limit: async () => [await mocks.get()] }) }) }),
  update: () => ({ set: (data: unknown) => { mocks.set(data); return { where: (condition: unknown) => { mocks.where(condition); return { returning: mocks.claim, then: (resolve: (value: unknown) => void) => resolve([]) }; } }; } }),
}) }));
import { POST } from "./route";
const jobId = "00000000-0000-4000-8000-000000000001";
const config: ResearchConfig = { approved: true, seeds: [], searchTerms: ["industrial cleaning"], researchScope: "Industrial cleaning and decontamination", geography: "VIC", discover: true, workflow: "business", mode: "automatic", adaptiveDiscovery: true, parallelDiscovery: true, discoveryCursor: 0, discoveryPending: true, targetBusinesses: 20, researchEffort: "focused", automaticDeadline: Date.now() + 1800000, budget: { maxPages: 10, maxDomains: 10, maxModelCalls: 10, maxMinutes: 15 } };
let job: { id: string; organizationId: string; mandateId: string; status: string; createdAt: Date; updatedAt: Date; seeds: string[]; config: ResearchConfig };
const call = (payload: unknown) => POST(new Request("https://app.example.com", { method: "POST", body: JSON.stringify(payload) }), { params: Promise.resolve({ jobId }) });
const planning = { query: "hazardous material remediation contractors", region: "Victoria", reason: "Explore specialist services", stop: false };
beforeEach(() => {
  vi.clearAllMocks();
  job = { id: jobId, organizationId: "org", mandateId: "mandate", status: "discovering", createdAt: new Date(), updatedAt: new Date(), seeds: [], config: structuredClone(config) };
  mocks.get.mockImplementation(async () => job);
  mocks.list.mockImplementation(async () => [job]);
  mocks.runJobs.mockImplementation(async () => [job]);
  mocks.claim.mockResolvedValue([{ id: jobId }]);
  mocks.search.mockResolvedValue([{ title: "Remediation contractor", snippet: "Hazardous material remediation", url: "https://remediation.example.com/" }]);
});
it("researches novel terminology without a lexical seed filter and saves query feedback", async () => {
  const response = await call({ action: "discover", decision: { planning, attemptIndex: 0 } });
  expect((await response.json()).more).toBe(true);
  expect(mocks.search).toHaveBeenCalledWith("hazardous material remediation contractors Victoria", expect.any(Function), jobId);
  expect(mocks.seeds).not.toHaveBeenCalled(); // Adaptive callbacks already persist seeds atomically.
  const saved = mocks.set.mock.calls.find(([data]) => data.seeds)?.[0];
  expect(saved.seeds).toEqual(["https://remediation.example.com/"]);
  // Drizzle retains parameter values in its SQL object; result metadata is persisted atomically with seeds.
  expect(JSON.stringify(new PgDialect().sqlToQuery(saved.config).params)).toContain('newDomains');
  expect(JSON.stringify(new PgDialect().sqlToQuery(saved.config).params)).toContain('Explore specialist services');
});
it("reuses committed attempts when a workflow callback is replayed", async () => {
  job.config.discoveryAttempts = [{ query: "already searched Victoria", status: "succeeded" }];
  const response = await call({ action: "discover", decision: { planning, attemptIndex: 0 } });
  expect((await response.json()).more).toBe(true);
  expect(mocks.search).not.toHaveBeenCalled();
});
it("enforces the search ceiling across continuations before contacting a provider", async () => {
  job.config.discoveryAttempts = Array.from({ length: 12 }, (_, i) => ({ query: `prior query ${i}`, status: "succeeded" }));
  const response = await call({ action: "discover", decision: { planning, attemptIndex: 12 } });
  expect((await response.json()).more).toBe(false);
  expect(mocks.search).not.toHaveBeenCalled();
});
it("does not search after cancellation or expiry, or while another callback holds the lease", async () => {
  job.status = "cancelled";
  await call({ action: "discover" });
  job.status = "discovering";
  job.config.automaticDeadline = 1;
  await call({ action: "discover" });
  job.config.automaticDeadline = Date.now() + 10000;
  mocks.claim.mockResolvedValue([]);
  expect(await (await call({ action: "discover", decision: { planning, attemptIndex: 0 } })).json()).toMatchObject({ deferred: true });
  expect(mocks.search).not.toHaveBeenCalled();
});
it("includes previous results and researched candidates in the next planner context", async () => {
  job.config.discoveryAttempts = [{ query: "industrial cleaners Victoria", status: "succeeded", newDomains: 0 }];
  const response = await call({ action: "discovery-context" });
  expect(await response.json()).toMatchObject({ scope: config.researchScope, remainingSearches: 11, attempts: [{ newDomains: 0 }] });
});

it("commits batch queries independently with append-only attempts and merged seeds", async () => {
  const { resolveDiscoveryBatch } = await import("@/domain/adaptive-discovery");
  const decision = resolveDiscoveryBatch({ decisions: [planning] }, { scope: "cleaning", startingTerms: [], regions: ["Victoria"], target: 20, found: 0, remainingSearches: 12, attempts: [], candidates: [] }, [], 1).queries[0];
  const response = await call({ action: "discover", decision });
  expect(response.status).toBe(200);
  expect(mocks.search).toHaveBeenCalledTimes(1);
  expect(mocks.dispatch).toHaveBeenCalledTimes(1);
  const update = mocks.set.mock.calls.find(([data]) => data.seeds)?.[0];
  const query = new PgDialect().sqlToQuery(update.config);
  expect(query.sql).toContain("discoveryAttempts");
  expect(query.sql).toContain("||");
  expect(query.sql).toContain("count(DISTINCT");
  const guards = mocks.where.mock.calls.map(([condition]) => new PgDialect().sqlToQuery(condition));
  const commitGuard = guards.find(q => q.sql.includes("discoveryClaims") && q.sql.includes("->>'id'"));
  expect(commitGuard?.sql).toContain("jsonb_array_length");
  expect(commitGuard?.params).toContain(12);
  expect(JSON.stringify(query.params)).toContain(decision.queryId);
  expect(JSON.stringify(query.params)).toContain("durationMs");
  expect(new PgDialect().sqlToQuery(update.seeds).sql).toContain("SELECT DISTINCT");
  expect(mocks.seeds).not.toHaveBeenCalled();
});

it("replays a committed batch query without searching and recovers candidate dispatch", async () => {
  const { discoveryQueryId } = await import("@/domain/adaptive-discovery");
  const query = "industrial cleaners Victoria", queryId = discoveryQueryId(query, 0, 0);
  job.config.discoveryAttempts = [{ query, queryId, status: "succeeded" }];
  const response = await call({ action: "discover", decision: { query, queryId, reason: "Explore cleaners", batchStartIndex: 0 } });
  expect(response.status).toBe(200);
  expect(mocks.search).not.toHaveBeenCalled();
  expect(mocks.dispatch).toHaveBeenCalledTimes(1);
});

it("defers an occupied batch claim and rejects mismatched stable identifiers", async () => {
  const { discoveryQueryId } = await import("@/domain/adaptive-discovery");
  const query = "industrial cleaners Victoria";
  const decision = { query, queryId: discoveryQueryId(query, 0, 0), reason: "Explore cleaners", batchStartIndex: 0 };
  mocks.claim.mockResolvedValue([]);
  expect(await (await call({ action: "discover", decision })).json()).toMatchObject({ deferred: true });
  expect((await call({ action: "discover", decision: { ...decision, query: "tampered query" } })).status).toBe(400);
  expect(mocks.search).not.toHaveBeenCalled();
});

it("defers a stale legacy completion without overwriting seeds or dispatching", async () => {
  mocks.claim.mockResolvedValueOnce([{ id: jobId }]).mockResolvedValueOnce([]);
  const response = await call({ action: "discover", decision: { planning, attemptIndex: 0 } });
  expect(await response.json()).toMatchObject({ deferred: true, more: true });
  expect(mocks.search).toHaveBeenCalledTimes(1);
  expect(mocks.seeds).not.toHaveBeenCalled();
  expect(mocks.dispatch).not.toHaveBeenCalled();
});

it.skipIf(!process.env.RESEARCH_SQL_TEST_URL)("executes batch claim and completion expressions in PostgreSQL without mutating rows", async () => {
  const { discoveryQueryId } = await import("@/domain/adaptive-discovery");
  const query = "industrial cleaners Victoria";
  const queryId = discoveryQueryId(query, 0, 0);
  expect((await call({ action: "discover", decision: { query, queryId, reason: "Explore cleaners", batchStartIndex: 0 } })).status).toBe(200);
  const updates = mocks.set.mock.calls.flatMap(([data], index) => data.config && new PgDialect().sqlToQuery(data.config).sql.includes("discoveryClaims") ? [{ config: data.config as SQL, guard: mocks.where.mock.calls[index][0] as SQL }] : []);
  const client = new Client({ connectionString: process.env.RESEARCH_SQL_TEST_URL });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const evaluate = async (expression: SQL, condition: SQL, fixture: ResearchConfig) => {
      const compiled = new PgDialect().sqlToQuery(sql`SELECT ${expression} AS result FROM (SELECT ${JSON.stringify(fixture)}::jsonb AS config, '[]'::jsonb AS seeds, ${jobId}::uuid AS id, 'discovering'::text AS status) AS research_jobs WHERE ${condition}`);
      return (await client.query(compiled.sql, compiled.params)).rows;
    };
    const claimed = await evaluate(updates[0].config, updates[0].guard, job.config);
    expect(claimed).toHaveLength(1);
    const claimedConfig = claimed[0].result;
    expect(claimedConfig.discoveryClaims[queryId].id).toEqual(expect.any(String));
    // The same query cannot be claimed twice while its lease is live.
    expect(await evaluate(updates[0].config, updates[0].guard, claimedConfig)).toEqual([]);
    const completed = await evaluate(updates[1].config, updates[1].guard, claimedConfig);
    expect(completed).toHaveLength(1);
    expect(completed[0].result.discoveryClaims).toEqual({});
    expect(completed[0].result.discoveryAttempts).toEqual([expect.objectContaining({ queryId, status: "succeeded", newDomains: 1 })]);
    expect(await evaluate(updates[1].config, updates[1].guard, completed[0].result)).toEqual([]);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});


it('builds discovery context from a narrow run-scoped repository read, without loading historical mandate jobs', async () => {
  const response = await call({ action: 'discovery-context' });
  expect(response.status).toBe(200);
  expect(mocks.runJobs).toHaveBeenCalledWith(jobId, 'mandate');
  expect(mocks.list).not.toHaveBeenCalled();
});
