import { expect, it } from "vitest";
import { discoveryRegions, discoveryPrompt, resolveDiscoveryDecision, type DiscoveryContext } from "./adaptive-discovery";
const context: DiscoveryContext = { scope: "Industrial cleaning and decontamination", startingTerms: [], regions: ["New South Wales", "Victoria"], target: 20, found: 0, remainingSearches: 12, attempts: [], candidates: [] };
const proposed = { query: "hazardous material remediation contractors", region: "Victoria", reason: "Explore specialist terminology found in trade listings.", stop: false };
it("allows new terminology, anchors geography and retains an explanation", () => {
  expect(resolveDiscoveryDecision(proposed, context, [])).toEqual({ query: "hazardous material remediation contractors Victoria", reason: proposed.reason, stop: false });
  expect(discoveryRegions("NSW, VIC; Queensland")).toEqual(["New South Wales", "Victoria", "Queensland"]);
});
it("rejects unsupported regions and duplicate queries, with a usable fallback", () => {
  expect(resolveDiscoveryDecision({ ...proposed, region: "California" }, context, ["industrial cleaning Victoria"]).query).toBe("industrial cleaning Victoria");
  const previous = { query: "Hazardous material remediation contractors Victoria", status: "succeeded" as const };
  expect(resolveDiscoveryDecision(proposed, { ...context, attempts: [previous] }, ["industrial cleaning NSW"]).query).toBe("industrial cleaning NSW");
});
it("retries a failed search once and counts retries within the budget", () => {
  const failed = { query: "industrial cleaning NSW", status: "failed" as const };
  expect(resolveDiscoveryDecision(proposed, { ...context, attempts: [failed] }, []).query).toBe(failed.query);
  expect(resolveDiscoveryDecision(proposed, { ...context, attempts: [failed, failed] }, []).query).toContain("remediation");
  expect(resolveDiscoveryDecision(proposed, { ...context, remainingSearches: 0, attempts: [failed] }, []).stop).toBe(true);
});
it("bounds stopping and gracefully handles malformed model output", () => {
  const stop = { query: "", region: "", reason: "Further avenues exhausted.", stop: true };
  expect(resolveDiscoveryDecision(stop, context, ["cleaners NSW"]).stop).toBe(false);
  expect(resolveDiscoveryDecision(stop, { ...context, attempts: ["a", "b", "c"].map(query => ({ query, status: "succeeded" })) }, []).stop).toBe(true);
  expect(resolveDiscoveryDecision(null, context, ["cleaners NSW"]).query).toBe("cleaners NSW");
  expect(resolveDiscoveryDecision(proposed, { ...context, found: 20 }, []).stop).toBe(true);
});
it("provides results and candidate outcomes as untrusted feedback without private brief data", () => {
  const prompt = discoveryPrompt({ ...context, attempts: [{ query: "industrial cleaning NSW", status: "succeeded", newDomains: 0, results: [{ title: "Trade listing", snippet: "Remediation contractors", url: "https://example.com/" }] }], candidates: [{ domain: "example.com", status: "complete", relevant: false }] });
  expect(prompt[0].content).toContain("untrusted data");
  expect(prompt[0].content).toContain("qualification questions");
  expect(prompt[1].content).toContain("Remediation contractors");
  expect(prompt[1].content).toContain('"newDomains":0');
});

it("ignores a planner stop while recent searches still surface new websites", () => {
  const stop = { query: "", region: "", reason: "Thoroughly explored.", stop: true };
  const productive = ["a", "b", "c"].map(query => ({ query, status: "succeeded" as const, resultCount: 10, newDomains: 6 }));
  const decision = resolveDiscoveryDecision(stop, { ...context, attempts: productive }, ["cleaners NSW"]);
  expect(decision.stop).toBe(false);
  expect(decision.query).toBe("cleaners NSW");
  const dry = [...productive.slice(0, 1), ...["d", "e"].map(query => ({ query, status: "succeeded" as const, resultCount: 10, newDomains: 0 }))];
  expect(resolveDiscoveryDecision(stop, { ...context, attempts: dry }, ["cleaners NSW"]).stop).toBe(true);
});

it("plans bounded distinct searches across regions with stable replay identifiers", async () => {
  const { resolveDiscoveryBatch, discoveryBatchPrompt } = await import("./adaptive-discovery");
  const batch = { decisions: [proposed, { ...proposed, region: "New South Wales" }, proposed] };
  const resolved = resolveDiscoveryBatch(batch, context, ["industrial cleaning Victoria"]);
  expect(resolved.queries.map(q => q.query)).toEqual(["hazardous material remediation contractors Victoria", "hazardous material remediation contractors New South Wales", "industrial cleaning Victoria"]);
  expect(new Set(resolved.queries.map(q => q.queryId)).size).toBe(3);
  expect(resolveDiscoveryBatch(batch, context, ["industrial cleaning Victoria"])).toEqual(resolved);
  expect(resolveDiscoveryBatch(batch, { ...context, remainingSearches: 1 }, []).queries).toHaveLength(1);
  expect(discoveryBatchPrompt(context)[0].content).toContain("distinct independent queries");
});

it("only includes a failed-query retry once within a batch and respects stopping", async () => {
  const { resolveDiscoveryBatch } = await import("./adaptive-discovery");
  const failed = { query: "industrial cleaning Victoria", status: "failed" as const };
  const resolved = resolveDiscoveryBatch({ decisions: [proposed, proposed, proposed] }, { ...context, attempts: [failed] }, ["industrial cleaning NSW"]);
  expect(resolved.queries.filter(q => q.query === failed.query)).toHaveLength(1);
  expect(resolveDiscoveryBatch(null, { ...context, found: 20 }, []).queries).toEqual([]);
});


it("retries failed searches even when a successful sibling completed last", async () => {
  const { resolveDiscoveryBatch } = await import("./adaptive-discovery");
  const failed = { query: "industrial cleaning Victoria", status: "failed" as const };
  const succeeded = { query: "decontamination Victoria", status: "succeeded" as const };
  const resolved = resolveDiscoveryBatch({ decisions: [proposed] }, { ...context, attempts: [failed, succeeded] }, ["cleaners NSW"]);
  expect(resolved.queries[0].query).toBe(failed.query);
  expect(resolved.queries.filter(q => q.query === failed.query)).toHaveLength(1);
  expect(resolveDiscoveryBatch(null, { ...context, attempts: [failed, succeeded, failed] }, []).queries).toEqual([]);
});
