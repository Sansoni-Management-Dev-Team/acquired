import { afterEach, expect, it, vi } from "vitest";
import { businessWebSeeds } from "./business-web-search";
afterEach(()=>vi.unstubAllEnvs());
it("bounds discovery, retains partial results, and rejects private URLs",async()=>{
  vi.stubEnv("TAVILY_API_KEY","fictional-test-key");
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({results:[{url:"https://instruments.example.com/"},{url:"https://127.0.0.1/"}]})).mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce(Response.json({results:[{url:"https://instruments.example.com/"}]}));
  const result = await businessWebSeeds(["sensors","calibration","instruments","ignored"],"Australia",fetcher);
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(result.seeds).toEqual(["https://instruments.example.com/"]);
  expect(result.warning).toContain("failed");
  expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toMatchObject({max_results:6,include_raw_content:false});
});
