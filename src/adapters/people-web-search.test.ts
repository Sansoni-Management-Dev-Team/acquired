import { afterEach, expect, it, vi } from "vitest";
import { peopleWebSeeds } from "./people-web-search";
afterEach(() => vi.unstubAllEnvs());
it("makes one bounded search and uses URLs rather than trusting snippets", async () => {
  vi.stubEnv("RESEARCH_WORKER_URL", "https://research.example.com"); vi.stubEnv("RESEARCH_SERVICE_SECRET", "test-key");
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ seeds: ["https://instruments.example.com/team", "http://localhost/", "https://spokeo.com/example"] }));
  expect(await peopleWebSeeds("Example Instruments", "instruments.example.com", fetcher)).toEqual(["https://instruments.example.com/team"]);
  expect(fetcher).toHaveBeenCalledOnce();
  const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
  expect(body).toMatchObject({ query: expect.stringContaining("Example Instruments") });
});
it("reports unavailable search instead of silently claiming coverage", async () => {
  vi.stubEnv("RESEARCH_WORKER_URL", "");
  await expect(peopleWebSeeds("Example", "example.com")).rejects.toThrow("not configured");
});
it("retains a profile connected to a source-supported legal operator",async()=>{
 vi.stubEnv('RESEARCH_WORKER_URL','https://research.example.com');vi.stubEnv('RESEARCH_SERVICE_SECRET','test-key');
 const {peopleWebSearch}=await import('./people-web-search');
 const url='https://www.linkedin.com/in/alexexample';
 const fetcher=vi.fn<typeof fetch>().mockResolvedValue(Response.json({seeds:[url],results:[{url,title:'Alex Example - Example Holdings Pty Ltd',snippet:'Director at Example Holdings Pty Ltd'}]}));
 const result=await peopleWebSearch('Example Instruments','instruments.example.com',fetcher,'query','Example Holdings Pty Ltd');
 expect(result.leads).toHaveLength(1);
});
