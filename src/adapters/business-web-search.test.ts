import { afterEach, expect, it, vi } from "vitest";
import { businessWebSeeds, sectorLexicon, seedRelevant } from "./business-web-search";
afterEach(()=>vi.unstubAllEnvs());
it("bounds discovery, retains partial results, and rejects private URLs",async()=>{
  vi.stubEnv("RESEARCH_WORKER_URL","https://research.example.com"); vi.stubEnv("RESEARCH_SERVICE_SECRET","fictional-test-key");
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({seeds:["https://instruments.example.com/","https://127.0.0.1/"]})).mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce(Response.json({seeds:["https://instruments.example.com/"]}));
  const result = await businessWebSeeds(["sensors","calibration","instruments","ignored"],"Australia",fetcher,undefined,0);
  expect(fetcher.mock.calls.length).toBeGreaterThanOrEqual(3); expect(fetcher.mock.calls.length).toBeLessThanOrEqual(12);
  expect(result.seeds).toEqual(["https://instruments.example.com/"]);
  expect(result.warning).toContain("failed");
  expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toMatchObject({query:expect.stringMatching(/^sensors manufacturer OR wholesaler Australia -"funeral director"/)});
});
it("keeps only results that name the brief's sector", () => {
  const terms = ["Coffin and casket hardware and components: fittings, handles, linings", "Funeral consumables manufacturers or distributors: urns and associated fittings", "Plastics or materials businesses serving the funeral supply chain"];
  expect(sectorLexicon(terms)).toEqual(expect.arrayContaining(["coffin", "casket", "funeral", "urn"]));
  expect(sectorLexicon(terms)).not.toContain("fitting");
  expect(seedRelevant({ url: "https://whitelily.example.com/", title: "White Lily Urns", snippet: "Handmade cremation urns for adults." }, terms)).toBe(true);
  expect(seedRelevant({ url: "https://hose.example.com/", title: "Hose Plus Fittings", snippet: "Hydraulic hose and fittings supplier Australia." }, terms)).toBe(false);
  expect(seedRelevant({ url: "https://zeus.example.com/", title: "Zeus", snippet: "Casket hardware and handles." }, terms)).toBe(true);
});
