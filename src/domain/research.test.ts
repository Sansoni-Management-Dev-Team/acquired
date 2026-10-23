import { describe, expect, it } from "vitest";
import {
  continueResearchConfig,  researchPerformanceFlags,
  researchActive,
  progressSchema,
  publicResearchUrl,
  parseResearchExtraction,
  researchStartSchema,
  validateFindings,
  followUpLinks,
} from "./research";
const source = "https://directory.example.com/members";
const page =
  "Example Instruments makes precision sensors. [Example Instruments](https://instruments.example.com/) [Products](/products) [Privacy](/privacy)";
const finding = {
  kind: "company",
  name: "Example Instruments",
  value: "precision sensors",
  quote: "Example Instruments makes precision sensors.",
  website: "https://instruments.example.com/",
};
describe("public research boundaries", () => {
  it.each([
    "http://example.com",
    "https://127.0.0.1",
    "https://[::1]",
    "https://private.internal",
    "https://user:password@example.com",
    "https://example.com:444",
  ])("rejects non-public or credentialed URL %s", (url) =>
    expect(publicResearchUrl(url)).toBeNull(),
  );
  it("removes query credentials and fragments", () =>
    expect(
      publicResearchUrl("https://example.com/products?token=secret#section"),
    ).toBe("https://example.com/products"));
  it("requires approval and enforces hard budgets", () => {
    const config = {
      requestId: "00000000-0000-4000-8000-000000000001",
      seeds: [],
      searchTerms: ["precision sensors"],
      geography: "Australia",
      approved: true,
      budget: { maxPages: 3, maxDomains: 3, maxMinutes: 10, maxModelCalls: 3 },
    };
    expect(researchStartSchema.safeParse(config).success).toBe(true);
    expect(
      researchStartSchema.safeParse({ ...config, approved: false }).success,
    ).toBe(false);
    expect(
      researchStartSchema.safeParse({
        ...config,
        budget: { ...config.budget, maxPages: 6 },
      }).success,
    ).toBe(false);
  });
  it("requires verbatim evidence and an observed website", () => {
    expect(validateFindings([finding], page, source)).toHaveLength(1);
    expect(
      validateFindings(
        [{ ...finding, value: "defence certification" }],
        page,
        source,
      ),
    ).toEqual([]);
    expect(
      validateFindings(
        [{ ...finding, website: "https://invented.example.com/" }],
        page,
        source,
      ),
    ).toEqual([]);
    expect(
      validateFindings(
        [{ ...finding, name: "Unrelated Business" }],
        page,
        source,
      ),
    ).toEqual([]);
  });
  it("follows relevant observed links, excluding navigation and visited URLs", () => {
    expect(followUpLinks(page, source, ["products"], [])).toEqual([
      "https://directory.example.com/products",
    ]);
    expect(
      followUpLinks(
        page,
        source,
        ["products"],
        ["https://directory.example.com/products"],
      ),
    ).toEqual([]);
  });
});

describe("Workers AI extraction formats", () => {
  it("accepts structured JSON mode objects", () => {
    expect(parseResearchExtraction({ response: { findings: [finding] } })).toEqual([finding]);
  });
  it("accepts JSON text and fenced JSON", () => {
    expect(parseResearchExtraction({ response: JSON.stringify({ findings: [finding] }) })).toEqual([finding]);
    expect(parseResearchExtraction({ response: "```json\n{\"findings\":[]}\n```" })).toEqual([]);
  });
  it("rejects malformed or missing findings", () => {
    expect(() => parseResearchExtraction({ response: "Here are some findings" })).toThrow();
    expect(() => parseResearchExtraction({ response: { other: [] } })).toThrow();
  });
});

it("bounds excessive model output without discarding valid quoted claims", () => {
  const records = Array.from({length: 14}, () => finding);
  expect(validateFindings(records, page, source)).toHaveLength(12);
  expect(validateFindings([{invalid: true}, finding], page, source)).toEqual([finding]);
});

it("does not follow obituary, data policy, testimonial or colour-chart detours", () => {
  const source = "https://supplier.example.com/";
  const markdown = ["obituaries/obituary-listings", "howwecollectandstoredata", "testimonials", "perspex-colour-chart", "products"].map(path => `[Supplier products](https://supplier.example.com/${path})`).join("\n");
  expect(followUpLinks(markdown, source, ["supplier products"], [])).toEqual([source + "products"]);
});


it('keeps absent performance flags disabled and enables each independently', () => {
  expect(researchPerformanceFlags({})).toEqual({ telemetryBatching: false, progressCoalescing: false, schedulerCoalescing: false });
  expect(researchPerformanceFlags({ performanceFlags: { progressCoalescing: true } })).toEqual({ telemetryBatching: false, progressCoalescing: true, schedulerCoalescing: false });
});

it('validates progress timing spans without requiring telemetry on legacy callbacks', () => {
  const event = { revision: 1, status: 'crawling', pages: 0, modelCalls: 0, message: 'Starting' };
  const span = { id: '00000000-0000-4000-8000-000000000001', step: 'read-people-1', segment: 'page_read', startedAt: '2026-09-30T00:00:00.000Z', finishedAt: '2026-09-30T00:00:00.001Z', elapsedMs: 1, outcome: 'succeeded' };
  expect(progressSchema.safeParse(event).success).toBe(true);
  expect(progressSchema.parse({ ...event, timingSpans: Array(64).fill(span) }).timingSpans).toHaveLength(64);
  expect(progressSchema.safeParse({ ...event, timingSpans: Array(65).fill(span) }).success).toBe(false);
  expect(progressSchema.safeParse({ ...event, timingSpans: [{ ...span, elapsedMs: -1 }] }).success).toBe(false);
});
it('stops automatic polling after the parallel queue settles while preserving active child polling', () => {
  const root = { status: 'partial', config: { mode: 'automatic', automaticDeadline: Date.now() + 60000, parallelResearchSettled: true } };
  expect(researchActive([root])).toBe(false);
  expect(researchActive([{ status: 'queued', config: { purpose: 'firmographics' } }, root])).toBe(true);
});

it('reopens parallel recovery when explicitly continuing a settled run',()=>{
 const config={approved:true as const,discover:false,seeds:[],searchTerms:[],geography:'Australia',parallelBusinessResearch:true,parallelResearchSettled:true,parallelResearchPendingTasks:0,budget:{maxPages:1,maxDomains:1,maxMinutes:1,maxModelCalls:1}};
 const next=continueResearchConfig(config, ['https://example.com/about'], [], config.budget,'old');
 expect(next.parallelResearchSettled).toBe(false);expect(next.parallelResearchPendingTasks).toBeUndefined();
});

it('ignores newest terminal page tasks when deciding whether a settled parallel root is active',()=>{
 const deadline=Date.now()+60000;
 expect(researchActive([{status:'complete',config:{mode:'automatic',researchTask:'page',automaticDeadline:deadline}},{status:'partial',config:{mode:'automatic',parallelResearchSettled:true,automaticDeadline:deadline}}])).toBe(false);
});

it('requires exact initial V5 basic-People scope and keeps old V4 company-only authority',()=>{
 const shared={requestId:'00000000-0000-4000-8000-000000000001',seeds:[],searchTerms:['industrial services'],geography:'Australia',approved:true,budget:{maxPages:3,maxDomains:3,maxMinutes:15,maxModelCalls:0},targetBusinesses:20,findPeople:false,includeCompanyPeople:true,includePhones:false};
 const policy={version:5,countryScope:'AU',desiredSourceCompanies:20,maxProfiledCompanies:800,firmablePageSize:100,maxFirmablePages:2,maxFirmableRows:200,maxWebQueries:6,maxWebRowsPerQuery:100,queryOrder:'subsector_round_robin',profileSelection:{strategy:'all_discovered',identity:'firmable_id_then_domain',companyOnly:false},automaticPeople:{version:1,maxCompanies:800,maxSearchPagesPerCompany:1,searchPageSize:50,maxContactsPerCompany:3,includePhones:false}};
 expect(researchStartSchema.safeParse({...shared,companyDiscoveryPolicy:policy}).success).toBe(true);
 for(const flags of [{includeCompanyPeople:false},{includePhones:true},{findPeople:true},{companyOnly:true},{targetBusinesses:19}])expect(researchStartSchema.safeParse({...shared,...flags,companyDiscoveryPolicy:policy}).success).toBe(false);
 const historical={...policy};Reflect.deleteProperty(historical,'automaticPeople');
 const v4={...historical,version:4,profileSelection:{...historical.profileSelection,companyOnly:true}};
 expect(researchStartSchema.safeParse({...shared,companyDiscoveryPolicy:v4,companyOnly:true,includeCompanyPeople:false}).success).toBe(true);
 expect(researchStartSchema.safeParse({...shared,companyDiscoveryPolicy:v4,companyOnly:true}).success).toBe(false);
});
