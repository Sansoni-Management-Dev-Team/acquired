import { describe, it, expect } from "vitest";
import {
  normalizeResearchFinding,
  orderResearchQueue,
  continueResearchConfig,
  researchQueries,
  groupResearchFindings,
  validateFindings,
  followUpLinks,
  type ResearchFinding,
  type ResearchConfig,
} from "./research";
const f: ResearchFinding = {
  kind: "capability",
  name: "National delivery",
  value: "National delivery",
  quote: "We provide National delivery for our instruments.",
  website: "https://example.com/",
};
describe("research quality", () => {
  it("moves business identifiers out of accreditation", () =>
    expect(
      normalizeResearchFinding({
        ...f,
        kind: "accreditation",
        name: "ABN",
        value: "12345678901",
      })?.kind,
    ).toBe("identifier"));
  it("rejects vague certification assertions", () =>
    expect(
      normalizeResearchFinding({
        ...f,
        kind: "accreditation",
        name: "National guidelines",
        quote: "Our products follow national guidelines.",
      }),
    ).toBeNull());
  it("requires a named standard and explicit certification assertion", () => {
    const cert = {
      ...f,
      kind: "accreditation" as const,
      name: "ISO 9001",
      value: "ISO 9001",
      quote: "Example Instruments is certified to ISO 9001.",
    };
    expect(normalizeResearchFinding(cert)).toEqual(cert);
    expect(
      normalizeResearchFinding({
        ...cert,
        quote: "Filter by ISO 9001 accredited suppliers",
      }),
    ).toBeNull();
  });
  it("rejects single-word fragments and general advice", () => {
    expect(normalizeResearchFinding({ ...f, value: "National" })).toBeNull();
    expect(
      normalizeResearchFinding({
        ...f,
        value: "natural environments",
        quote: "Natural environments are now an option.",
      }),
    ).toBeNull();
  });
  it("requires a stated subject to appear in evidence", () =>
    expect(
      validateFindings(
        [{ ...f, subject: "Unrelated Company" }],
        f.quote,
        f.website,
      ),
    ).toEqual([]));
  it("deduplicates company claims across source pages and removes unsupported legacy claims", () => {
    const saved = {
      id: "1",
      jobId: "job",
      sourceUrl: "https://example.com/",
      observedAt: "2026-01-01T00:00:00Z",
      confidence: 0.5,
      targetId: null,
      evidence: f,
    };
    const groups = groupResearchFindings([
      saved,
      { ...saved, id: "2", sourceUrl: "https://www.example.com/products" },
      { ...saved, id: "3", evidence: { ...f, value: "National" } },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].claims).toHaveLength(1);
    expect(groups[0].claims[0].sources).toHaveLength(2);
    expect(groups[0].excluded).toBe(1);
  });
  it("canonicalizes www aliases and favours unseen websites", () =>
    expect(
      orderResearchQueue(
        [
          "https://first.example.com/",
          "https://first.example.com/products",
          "https://second.example.com/",
        ],
        ["https://www.first.example.com/"],
      ),
    ).toEqual([
      "https://second.example.com/",
      "https://first.example.com/products",
    ]));
  it("splits long product descriptions into focused searches", () =>
    expect(
      researchQueries(["Industrial sensors: load cells, torque sensors"]),
    ).toEqual([
      "Industrial sensors load cells",
      "Industrial sensors torque sensors",
    ]));
  it("prioritizes supplier pages over consumer articles", () =>
    expect(
      followUpLinks(
        "[How to choose sensors](/blog/sensors) [Products](/products)",
        "https://example.com/",
        ["sensors"],
        [],
      ),
    ).toEqual(["https://example.com/products"]));
  it("continues only saved remaining work with new counters and an explicit budget", () => {
    const config: ResearchConfig = {
      seeds: [],
      searchTerms: ["sensors"],
      geography: "Australia",
      discover: true,
      approved: true,
      budget: { maxPages: 3, maxDomains: 3, maxMinutes: 10, maxModelCalls: 3 },
      runtime: {
        remaining: ["https://second.example.com/"],
        visited: ["https://first.example.com/"],
        attempts: [
          { url: "https://first.example.com/", status: "read", reason: "Read" },
        ],
      },
    };
    const resumed = continueResearchConfig(
      config,
      [],
      [],
      { ...config.budget, maxPages: 1 },
      "prior",
    );
    expect(resumed.discover).toBe(false);
    expect(resumed.runtime?.attempts).toEqual([]);
    expect(resumed.runtime?.remaining).toEqual(config.runtime?.remaining);
    expect(resumed.budget.maxPages).toBe(1);
  });
});
