import { beforeEach, expect, it, vi } from "vitest";
import type { ResearchConfig } from "@/domain/research";
import type { TargetCandidate } from "@/domain/models";

const mocks = vi.hoisted(() => ({
  discover: vi.fn(), getMandate: vi.fn(), attachMany: vi.fn(), recordCoverage: vi.fn(),
  upsert: vi.fn(), repoGet: vi.fn(), repoList: vi.fn(), updates: [] as unknown[],
}));
vi.mock("@/lib/research-service", () => ({ researchEnabled: () => true, researchServiceAuthorized: () => true }));
vi.mock("@/lib/automatic-discovery", () => ({ dispatchDiscoveryCandidates: vi.fn() }));
vi.mock("@/lib/automatic-enrichment", () => ({ dispatchAutomaticEnrichment: vi.fn() }));
vi.mock("@/lib/research-continuation", () => ({ dispatchContinuation: vi.fn() }));
vi.mock("@/lib/business-research-people", () => ({ dispatchBusinessPeople: vi.fn() }));
vi.mock("@/adapters/provider-mode", () => ({ createTargetDataProvider: () => ({ manufacturingDirectory: { search: vi.fn() }, places: {} }) }));
vi.mock("@/adapters/mandate-discovery", () => ({ discoverMandate: mocks.discover }));
vi.mock("@/domain/scoring", () => ({ rankTarget: (target: unknown) => target }));
vi.mock("@/domain/acquisition", async importOriginal => ({
  ...await importOriginal<typeof import("@/domain/acquisition")>(),
  briefToMandate: () => ({ sectors: ["Cleaning"], states: [], locations: ["Australia"], revenue: { min: 0, max: null }, ebitda: { min: 0, max: null } }),
}));
vi.mock("@/db/acquisition-repository", () => ({ AcquisitionRepository: class {
  getMandate = mocks.getMandate; attachMany = mocks.attachMany; recordCoverage = mocks.recordCoverage;
} }));
vi.mock("@/db/repositories", () => ({ OrganizationRepository: class { upsertEnrichedTarget = mocks.upsert; } }));
vi.mock("@/db/research-repository", () => ({ ResearchRepository: class {
  get = mocks.repoGet; list = mocks.repoList; seeds = vi.fn(); claimDiscovery = vi.fn();
} }));

let job: {
  id: string; organizationId: string; mandateId: string; createdBy: string; status: string;
  discoveryStarted: boolean; createdAt: Date; updatedAt: Date; seeds: string[]; config: ResearchConfig;
};
vi.mock("@/db/client", () => {
  const database = {
    select: (fields?: Record<string, unknown>) => fields?.domain ? {
      from: () => ({ innerJoin: () => ({ where: async () => [] }) }),
    } : {
      from: () => ({ where: () => ({ limit: async () => [job] }) }),
    },
    update: () => ({ set: (data: Record<string, unknown>) => {
      mocks.updates.push(data);
      if (data.config && typeof data.config === "object" && "discoverySourcesPrepared" in data.config) job.config = data.config as ResearchConfig;
      if (Array.isArray(data.seeds)) job.seeds = data.seeds as string[];
      if (typeof data.discoveryStarted === "boolean") job.discoveryStarted = data.discoveryStarted;
      return { where: () => ({ returning: async () => [{ id: job.id }], then: (resolve: (value: unknown) => void) => resolve([]) }) };
    } }),
    transaction: async (run: (tx: unknown) => Promise<unknown>) => run(database),
  };
  return { requireDb: () => database };
});

import { POST } from "./route";
const jobId = "00000000-0000-4000-8000-000000000001";
const baseConfig: ResearchConfig = {
  approved: true, seeds: [], searchTerms: ["industrial cleaning"], geography: "National",
  discover: true, workflow: "business", mode: "automatic", parallelDiscovery: true,
  targetBusinesses: 20, budget: { maxPages: 10, maxDomains: 10, maxModelCalls: 10, maxMinutes: 15 },
};
const candidate = (index: number): TargetCandidate => ({
  id: `candidate-${index}`, organisationId: "org", companyName: `Candidate ${index}`,
  domain: `candidate-${index}.com.au`, suburb: "Melbourne", state: "VIC", status: "identified", signals: [],
  sector: { value: "Cleaning", provenance: { source: "directory", capturedAt: "2026-01-01", confidence: 0.8 } },
  revenue: { value: null, provenance: { source: "directory", capturedAt: "2026-01-01", confidence: 0.2 } },
  ebitda: { value: null, provenance: { source: "directory", capturedAt: "2026-01-01", confidence: 0.2 } },
  headcount: { value: null, provenance: { source: "directory", capturedAt: "2026-01-01", confidence: 0.2 } },
  establishedYear: { value: null, provenance: { source: "directory", capturedAt: "2026-01-01", confidence: 0.2 } },
  sourceData: {
    googlePlaces: { placeId: `place-${index}`, types: [] },
    manufacturingDirectory: { recordId: `record-${index}`, name: `Candidate ${index}`, categories: [], keywords: [], capabilities: [], sourceRecords: [] },
  },
});
const call = (action: string) => POST(new Request("https://app.example.com", { method: "POST", body: JSON.stringify({ action }) }), { params: Promise.resolve({ jobId }) });

beforeEach(() => {
  vi.clearAllMocks(); mocks.updates.length = 0;
  job = { id: jobId, organizationId: "org", mandateId: "mandate", createdBy: "user", status: "discovering", discoveryStarted: false, createdAt: new Date(), updatedAt: new Date(), seeds: [], config: structuredClone(baseConfig) };
  mocks.repoGet.mockImplementation(async () => job);
  mocks.repoList.mockResolvedValue([job]);
  mocks.getMandate.mockResolvedValue({ brief: { name: "Cleaning", naturalLanguage: "Cleaning", sectors: ["Cleaning"], locations: [], states: [], requirements: [], unknownFields: [] } });
  mocks.upsert.mockImplementation(async ({ target }: { target: TargetCandidate }) => ({ id: target.id }));
});

it("stages public URLs and sourced directory records without persisting Google listing content", async () => {
  mocks.discover.mockResolvedValue({ targets: [candidate(1)], sources: [{ name: "Directory", status: "searched", discovered: 1, unique: 1, overlap: 0, checkedAt: "2026-01-01", note: "Complete" }] });
  const response = await call("discovery-sources");
  expect(await response.json()).toEqual({ pending: true });
  expect(job.seeds).toEqual(["https://candidate-1.com.au/"]);
  expect(job.config.discoverySourceCandidates).toHaveLength(1);
  expect(job.config.discoverySourceCandidates?.[0].sourceData?.googlePlaces).toBeUndefined();
  expect(job.config.discoverySourceCandidates?.[0].sourceData?.manufacturingDirectory?.recordId).toBe("record-1");
});

it("persists at most eight candidates in one callback and attaches them in one batch", async () => {
  job.discoveryStarted = true;
  job.config = { ...structuredClone(baseConfig), discoverySourcesPrepared: true, discoverySourceCandidates: Array.from({ length: 10 }, (_, i) => candidate(i)), discoverySourceCursor: 0, discoverySourceCoverage: [], discoverySourceCoverageRecorded: false };
  const response = await call("discovery-persist");
  expect(await response.json()).toEqual({ pending: true });
  expect(mocks.upsert).toHaveBeenCalledTimes(8);
  expect(mocks.attachMany).toHaveBeenCalledWith("mandate", Array.from({ length: 8 }, (_, i) => `candidate-${i}`));
  expect(mocks.recordCoverage).not.toHaveBeenCalled();
});

it("records source coverage and clears staged records after the final batch", async () => {
  job.discoveryStarted = true;
  const coverage = [{ name: "Directory", status: "searched" as const, discovered: 2, unique: 2, overlap: 0, checkedAt: "2026-01-01", note: "Complete" }];
  job.config = { ...structuredClone(baseConfig), discoverySourcesPrepared: true, discoverySourceCandidates: [candidate(1), candidate(2)], discoverySourceCursor: 0, discoverySourceCoverage: coverage, discoverySourceCoverageRecorded: false };
  const response = await call("discovery-persist");
  expect(await response.json()).toEqual({ pending: false });
  expect(mocks.attachMany).toHaveBeenCalledWith("mandate", ["candidate-1", "candidate-2"]);
  expect(mocks.recordCoverage).toHaveBeenCalledWith("mandate", coverage);
  expect(mocks.updates).toHaveLength(2);
});
