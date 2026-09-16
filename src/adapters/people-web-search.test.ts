import { afterEach, expect, it, vi } from "vitest";
import { peopleWebSeeds, peopleWebSearch } from "./people-web-search";
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

it("keeps D&B legal-entity results when the trading name is absent", async () => {
 vi.stubEnv('RESEARCH_WORKER_URL','https://research.example.com');vi.stubEnv('RESEARCH_SERVICE_SECRET','test-key');
 const url='https://www.dnb.com/business-directory/company-profiles/example-holdings.123';
 const fetcher=vi.fn<typeof fetch>().mockResolvedValue(Response.json({seeds:[url],results:[{url,title:'Example Holdings Pty Ltd Company Profile',snippet:'Example Holdings Pty Ltd key principal is Alex Example'}]}));
 expect(await peopleWebSeeds('Example Instruments','instruments.example.com',fetcher,'Example Holdings Pty Ltd')).toEqual([url]);
});

it("finds ownership articles before generic company profiles and retains public directory leads", async () => {
 vi.stubEnv("RESEARCH_WORKER_URL","https://research.example.com"); vi.stubEnv("RESEARCH_SERVICE_SECRET","test-key");
 const article="https://www.cranesandlifting.com.au/australian-load-measuring-technology-built-tough/";
 const directory="https://www.zoominfo.com/pic/delphi-measurement-pty-ltd/346253626";
 const results=[{url:"https://www.linkedin.com/company/delphi-measurements",title:"Delphi Measurement",snippet:"Company profile"},{url:directory,title:"Delphi Measurement Employee Directory",snippet:"employees are Michael Leonard, Darren Fraser. Website: delphimeasurement.com"},{url:article,title:"Australian load measuring technology, built tough",snippet:"Delphi Measurement. Co-owner Mike Leonard says the keys to success."},{url:"https://other.example.com/article",title:"Another Business",snippet:"Co-owner Casey Other"}];
 const fetcher=vi.fn<typeof fetch>().mockResolvedValue(Response.json({seeds:results.map(r=>r.url),results}));
 const found=await peopleWebSearch("Delphi Measurement","delphimeasurement.com",fetcher);
 expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string).query).toBe('"Delphi Measurement" owner');
 expect(found.seeds[0]).toBe(article);
 expect(found.leads.map(l=>l.url)).toEqual([article,directory]);
 expect(found.seeds).not.toContain("https://other.example.com/article");
 expect(found).not.toHaveProperty("findings");
});
