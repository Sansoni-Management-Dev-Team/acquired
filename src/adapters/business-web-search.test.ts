import { afterEach, expect, it, vi } from "vitest";
import { businessWebSeeds } from "./business-web-search";
afterEach(()=>vi.unstubAllEnvs());
it("bounds discovery, retains partial results, and rejects private URLs",async()=>{
  vi.stubEnv("RESEARCH_WORKER_URL","https://research.example.com"); vi.stubEnv("RESEARCH_SERVICE_SECRET","fictional-test-key");
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({seeds:["https://instruments.example.com/","https://127.0.0.1/"]})).mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce(Response.json({seeds:["https://instruments.example.com/"]}));
  const result = await businessWebSeeds(["sensors","calibration","instruments","ignored"],"Australia",fetcher);
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(result.seeds).toEqual(["https://instruments.example.com/"]);
  expect(result.warning).toContain("failed");
  expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toMatchObject({query:"sensors manufacturers suppliers businesses Australia"});
});
