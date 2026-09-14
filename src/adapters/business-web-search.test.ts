import { afterEach, expect, it, vi } from "vitest";
import { businessWebSeeds, sectorLexicon, seedRelevant, expandedSupplierQueries, discoveryQueryPlan } from "./business-web-search";
afterEach(()=>vi.unstubAllEnvs());
it('covers six industrial target types with specific phrases and supported search requests', () => {
  const terms = ['Calibration and test laboratories servicing industrial or defence clients', 'Sensor and instrumentation manufacturers (load cells, torque sensors, environmental monitoring)', 'Precision machining, including CNC turning and milling, supplying industrial customers', 'Defence-accredited components', 'Steel fabrication and welding certification', 'Specialist IP manufacturers'];
  const plan = discoveryQueryPlan(terms, 'Australia');
  const queries = plan.map(p => p.query);
  for (const phrase of ['Calibration and test laboratories services', 'load cells supplier', 'torque sensors supplier', 'CNC turning and milling', 'Defence-accredited components', 'Steel fabrication', 'IP manufacturers']) expect(queries.some(q => q.includes(phrase))).toBe(true);
  expect(queries.every(q => !q.includes('funeral') && !q.includes('wholesaler'))).toBe(true);
  expect(plan.every(q => q.page === 1 && !q.engine)).toBe(true);
  expect(new Set(queries).size).toBe(queries.length);
});
it("bounds discovery, retains partial results, and rejects private URLs",async()=>{
  vi.stubEnv("RESEARCH_WORKER_URL","https://research.example.com"); vi.stubEnv("RESEARCH_SERVICE_SECRET","fictional-test-key");
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({seeds:["https://instruments.example.com/","https://127.0.0.1/"]})).mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce(Response.json({seeds:["https://instruments.example.com/"]}));
  const result = await businessWebSeeds(["sensors","calibration","instruments","ignored"],"Australia",fetcher,undefined,0);
  expect(fetcher.mock.calls.length).toBeGreaterThanOrEqual(3); expect(fetcher.mock.calls.length).toBeLessThanOrEqual(40);
  expect(result.seeds).toEqual(["https://instruments.example.com/"]);
  expect(result.warning).toContain("failed");
  expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toMatchObject({query:"sensors supplier Australia"});
});
it("keeps only results that name the brief's sector", () => {
  const terms = ["Coffin and casket hardware and components: fittings, handles, linings", "Funeral consumables manufacturers or distributors: urns and associated fittings", "Plastics or materials businesses serving the funeral supply chain"];
  expect(sectorLexicon(terms)).toEqual(expect.arrayContaining(["coffin", "casket", "funeral", "urn"]));
  expect(sectorLexicon(terms)).not.toContain("fitting");
  expect(seedRelevant({ url: "https://whitelily.example.com/", title: "White Lily Urns", snippet: "Handmade cremation urns for adults." }, terms)).toBe(true);
  expect(seedRelevant({ url: "https://hose.example.com/", title: "Hose Plus Fittings", snippet: "Hydraulic hose and fittings supplier Australia." }, terms)).toBe(false);
  expect(seedRelevant({ url: "https://zeus.example.com/", title: "Zeus", snippet: "Casket hardware and handles." }, terms)).toBe(true);
});
it("expands discovery phrasing from the brief's sector words and regions, bounded", () => {
  const terms = ["Coffin and casket hardware and components: fittings, handles, linings", "Funeral consumables manufacturers or distributors: urns and associated fittings"];
  const queries = expandedSupplierQueries(terms, "National");
  expect(queries.length).toBeLessThanOrEqual(28);
  expect(queries.some(q => /^coffin fittings supplier Victoria/i.test(q))).toBe(true);
  expect(queries.some(q => /^Funeral urns supplier Queensland/.test(q))).toBe(true);
  expect(expandedSupplierQueries(terms, "Victoria").every(q => q.includes("Victoria"))).toBe(true);
});
