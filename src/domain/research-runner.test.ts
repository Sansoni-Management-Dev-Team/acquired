import { describe, expect, it, vi } from "vitest";
import {
  runResearch,
  type ResearchServices,
  type ResearchSteps,
} from "./research-runner";
import type { ResearchConfig } from "./research";
import { ResearchAiError } from "./research-ai-error";
import { BrowserAdmissionDeferred } from "./research-provider-error";
it('continues owner searches after a restart leaves only previously visited seeds', async () => {
  const t = setup();
  Object.assign(t.config, { mode: 'automatic', purpose: 'people', targetedFollowup: true, maxPeopleSearches: 2, companyName: 'Example Instruments', companyDomain: 'instruments.example.com', runtime: { remaining: [], visited: [...t.config.seeds], attempts: [] } });
  t.service.discover = vi.fn(async () => ({ seeds: [...t.config.seeds] }));
  t.service.targetedSearch = vi.fn(async () => ({ seeds: [], exhausted: true }));
  // Bound diagnostics so a regression fails instead of hanging the test process.
  let queues = 0;
  t.service.diagnostic = event => { if (event.event === 'source_queue' && ++queues > 10) throw new Error('No-progress loop'); };
  await runResearch(t.step, t.service);
  expect(t.service.targetedSearch).toHaveBeenCalledWith('people', 1);
  expect(t.service.submit).not.toHaveBeenCalled();
  expect(queues).toBeLessThan(10);
  expect(t.progress.mock.calls.at(-1)?.[0].message).not.toContain('No-progress loop');
});
it('finds revenue after headcount and completes only when both objectives have evidence', async () => {
  const t = setup();
  Object.assign(t.config, { mode: 'automatic', purpose: 'firmographics', targetedFollowup: true, companyName: 'Example Instruments', companyDomain: 'instruments.example.com' });
  t.config.budget = { maxPages: 5, maxDomains: 2, maxMinutes: 10, maxModelCalls: 0 };
  t.service.readPage = vi.fn(async url => ({ status: 'completed', page: { url, markdown: url.endsWith('/financials') ? '# Example Instruments\nOur annual revenue is AUD 12 million.' : '# Example Instruments\nWe employ 50 employees.' } }));
  t.service.targetedSearch = vi.fn(async () => ({ seeds: ['https://instruments.example.com/financials'], exhausted: true }));
  await runResearch(t.step, t.service);
  expect(t.service.targetedSearch).toHaveBeenCalledWith('revenue', 1);
  expect(t.service.readPage).toHaveBeenCalledTimes(2);
  expect(t.progress.mock.calls.at(-1)?.[0]).toMatchObject({ status: 'complete', pages: 2 });
  expect(t.progress.mock.calls.flatMap(([event]) => event.page?.findings || []).some(f => f.kind === 'revenue' && f.factMetadata?.currency === 'AUD')).toBe(true);
});
it('reads the first-party sitemap and adds relevant company pages to the research queue', async () => {
  const t = setup();
  Object.assign(t.config, { mode: 'automatic', purpose: 'firmographics', targetedFollowup: false, companyName: 'Example Instruments', companyDomain: 'instruments.example.com' });
  t.config.budget = { maxPages: 2, maxDomains: 1, maxMinutes: 10, maxModelCalls: 0 };
  t.service.readPage = vi.fn(async url => ({ status: 'completed', page: { url, markdown: url.endsWith('/team/') ? '# Example Instruments team\nWe employ 50 employees across Australia.' : '# Example Instruments\nWe manufacture precision sensors and calibration equipment for Australian industry.' } }));
  t.service.readSiteFile = vi.fn(async url => ({ status: 'completed', page: { url, markdown: url.endsWith('/robots.txt') ? 'Sitemap: https://instruments.example.com/sitemap.xml' : '<urlset><url><loc>https://instruments.example.com/team/</loc></url></urlset>' } }));
  await runResearch(t.step, t.service);
  expect(t.service.readSiteFile).toHaveBeenCalledTimes(2);
  expect(t.service.readPage).toHaveBeenCalledWith('https://instruments.example.com/team/');
  expect(t.progress.mock.calls.flatMap(([event]) => event.page?.findings || []).some(f => f.kind === 'headcount')).toBe(true);
});
it('searches for a published email after finding a director without rereading the team page', async () => {
  const t = setup();
  Object.assign(t.config, { mode: 'automatic', purpose: 'people', targetedFollowup: true, maxPeopleSearches: 2, companyName: 'Example Instruments', companyDomain: 'instruments.example.com' });
  t.config.budget = { maxPages: 5, maxDomains: 2, maxMinutes: 10, maxModelCalls: 0 };
  t.service.readPage = vi.fn(async url => ({ status: 'completed', page: { url, markdown: '# Our team\n#### Alex Example\n##### Managing Director' + (url.endsWith('/contact') ? '\nalex@instruments.example.com' : '') } }));
  t.service.targetedSearch = vi.fn(async () => ({ seeds: ['https://instruments.example.com/contact', ...t.config.seeds], exhausted: true }));
  await runResearch(t.step, t.service);
  expect(t.service.targetedSearch).toHaveBeenCalledWith('email', 1);
  expect(t.service.readPage).toHaveBeenCalledTimes(2);
  expect(t.progress.mock.calls.at(-1)?.[0].status).toBe('complete');
  expect(t.progress.mock.calls.flatMap(([event]) => event.page?.findings || []).some(f => f.email === 'alex@instruments.example.com')).toBe(true);
});
it('keeps the same objective active after a transient search failure', async () => {
  const t = setup();
  Object.assign(t.config, { purpose: 'firmographics', targetedFollowup: true, companyName: 'Example Instruments', companyDomain: 'instruments.example.com' });
  t.config.budget = { maxPages: 5, maxDomains: 2, maxMinutes: 10, maxModelCalls: 0 };
  t.service.readPage = vi.fn(async url => ({ status: 'completed', page: { url, markdown: '# Example Instruments\nWe employ 50 employees.' } }));
  t.service.targetedSearch = vi.fn().mockResolvedValueOnce({ seeds: [], failed: true, warning: 'Temporary provider failure' }).mockResolvedValue({ seeds: [], exhausted: true });
  await runResearch(t.step, t.service);
  expect(vi.mocked(t.service.targetedSearch).mock.calls.map(([field]) => field)).toEqual(['revenue', 'revenue']);
  expect(t.progress.mock.calls.at(-1)?.[0].message).toContain('revenue remains unknown');
});
function setup() {
  const config: ResearchConfig = {
    seeds: ["https://instruments.example.com/"],
    searchTerms: ["sensors"],
    geography: "Australia",
    approved: true,
    discover: false,
    budget: { maxPages: 2, maxDomains: 1, maxMinutes: 10, maxModelCalls: 2 },
  };
  let status = "queued",
    now = 0;
  const progress = vi.fn<ResearchServices["progress"]>(async (e) => {
    if (status !== "cancelled") status = e.status;
  });
  const service: ResearchServices = {
    control: vi.fn(async () => ({
      status,
      config,
      seeds: config.seeds,
      deadline: 600000,
    })),
    discover: vi.fn(async () => ({ seeds: [] })),
    progress,
    submit: vi.fn(async () => "00000000-0000-4000-8000-000000000010"),
    poll: vi.fn(async () => ({
      status: "completed",
      page: {
        url: config.seeds[0],
        markdown:
          "Example Instruments makes sensors. [Sensor products](/products)",
      },
    })),
    cancel: vi.fn(async () => {}),
    extract: vi.fn(async () => [
      {
        kind: "company",
        name: "Example Instruments",
        value: "sensors",
        quote: "Example Instruments makes sensors.",
        website: config.seeds[0],
      },
    ]),
    now: () => now,
  };
  const step: ResearchSteps = {
    do: vi.fn(async (_name, run) => run()),
    sleep: vi.fn(async () => {}),
  };
  return {
    config,
    service,
    step,
    progress,
    setStatus: (s: string) => {
      status = s;
    },
    setNow: (n: number) => {
      now = n;
    },
  };
}
describe('Headland extraction recovery', () => {
  it.each(['Free research AI reached its output token limit', 'Free research AI response did not match the research schema', 'Mercury fallback unavailable: request timed out or transport failed'])('retries %s using the same page and a smaller request', async message => {
    const t = setup();
    Object.assign(t.config, { workflow: 'business', researchTask: 'page', companyName: 'Example Instruments', companyDomain: 'instruments.example.com' });
    const markdown = '# Example Instruments\nWe manufacture precision sensors.\n' + 'Public product description. '.repeat(400);
    t.service.readPage = vi.fn(async url => ({ status: 'completed', page: { url, markdown } }));
    t.service.extract = vi.fn().mockRejectedValueOnce(new ResearchAiError(message)).mockResolvedValue([{ kind: 'capability', name: 'Precision sensors', value: 'manufacture precision sensors', quote: 'We manufacture precision sensors.', website: t.config.seeds[0], relevance: 'relevant' }]);
    await runResearch(t.step, t.service);
    expect(t.service.readPage).toHaveBeenCalledTimes(1);
    expect(t.service.extract).toHaveBeenCalledTimes(2);
    const requests = vi.mocked(t.service.extract).mock.calls.map(([messages]) => messages);
    expect(requests[1][1].content.length).toBeLessThan(requests[0][1].content.length);
    expect(t.progress.mock.calls.at(-1)?.[0]).toMatchObject({ status: 'complete', pages: 1, modelCalls: 2 });
    expect(t.progress.mock.calls.at(-1)?.[0].runtime?.attempts[0].extraction).toMatchObject({ status: 'completed', attempts: 2 });
    expect(t.progress.mock.calls.flatMap(([e]) => e.page?.findings || [])).toContainEqual(expect.objectContaining({ kind: 'capability', value: 'manufacture precision sensors' }));
  });
  it('reads a Headland legal PDF discovered on its own site to satisfy only ABN', async () => {
    const t = setup();
    Object.assign(t.config, { workflow: 'business', mode: 'automatic', purpose: 'firmographics', researchTask: 'field', researchField: 'abn', companyName: 'Headland Technology', companyDomain: 'headland.au', seeds: ['https://headland.au/'], budget: { maxPages: 2, maxDomains: 1, maxMinutes: 10, maxModelCalls: 0 } });
    t.service.readPage = vi.fn(async url => ({ status: 'completed', page: { url, markdown: url.endsWith('.pdf') ? 'Headland Technology Pty Ltd ABN 96 004 338 961 respects your privacy.' : '# Headland Technology\n[Privacy Policy](/static/privacy-policy.pdf)' } }));
    await runResearch(t.step, t.service);
    expect(t.service.readPage).toHaveBeenCalledWith('https://headland.au/static/privacy-policy.pdf');
    expect(t.progress.mock.calls.at(-1)?.[0]).toMatchObject({ status: 'complete', pages: 2 });
    expect(t.progress.mock.calls.flatMap(([e]) => e.page?.findings || [])).toContainEqual(expect.objectContaining({ name: 'ABN', value: '96004338961' }));
  });
  it('does not exceed the model budget when extraction fails', async () => {
    const t = setup(); t.config.budget.maxModelCalls = 1;
    t.service.extract = vi.fn().mockRejectedValue(new ResearchAiError('Free research AI reached its output token limit'));
    await runResearch(t.step, t.service);
    expect(t.service.extract).toHaveBeenCalledTimes(1);
    expect(t.progress.mock.calls.at(-1)?.[0]).toMatchObject({ status: 'partial', modelCalls: 1 });
  });
  it('checks cancellation before a recovery attempt', async () => {
    const t = setup();
    t.service.extract = vi.fn(async () => { t.setStatus('cancelled'); throw new ResearchAiError('Free research AI reached its output token limit'); });
    await runResearch(t.step, t.service);
    expect(t.service.extract).toHaveBeenCalledTimes(1);
  });
});
describe("bounded research orchestration", () => {
  it("uses the local direct reader with the same extraction and progress, without cloud crawl calls", async () => {
    const t = setup();
    t.service.readPage = vi.fn(async url => ({ status: "completed", page: { url, markdown: "Example Instruments makes sensors." } }));
    await runResearch(t.step, t.service);
    expect(t.service.readPage).toHaveBeenCalled();
    expect(t.service.extract).toHaveBeenCalled();
    expect(t.service.submit).not.toHaveBeenCalled();
    expect(t.service.poll).not.toHaveBeenCalled();
    expect(t.progress.mock.calls.some(([event]) => event.page?.findings.length)).toBe(true);
  });
  it("does not fall back to cloud crawling when the local reader fails", async () => {
    const t = setup();
    t.service.readPage = vi.fn().mockRejectedValue(new Error("Local reader offline"));
    await runResearch(t.step, t.service);
    expect(t.service.submit).not.toHaveBeenCalled();
    expect(t.service.poll).not.toHaveBeenCalled();
    expect(t.service.extract).not.toHaveBeenCalled();
  });
  it.each([
    [new ResearchAiError("Free research AI reached its output token limit"), "output token limit"],
    [new Error("private provider response"), "Evidence extraction failed; page read successfully"],
  ])("persists safe extraction diagnostics while retaining the read page", async (error, expected) => {
    const t = setup();
    t.service.extract = vi.fn().mockRejectedValue(error);
    await runResearch(t.step, t.service);
    const events = JSON.stringify(t.progress.mock.calls);
    expect(events).toContain(expected);
    expect(events).not.toContain("private provider response");
    expect(t.progress.mock.calls.at(-1)?.[0].pages).toBeGreaterThan(0);
  });
  it("retains explicit website statements when AI has no supported output", async () => {
    const t = setup();
    t.config.budget.maxPages = 1;
    vi.mocked(t.service.extract).mockResolvedValue([]);
    vi.mocked(t.service.poll).mockResolvedValue({status:"completed",page:{url:t.config.seeds[0],markdown:"We are a wholesale supplier and only sell to laboratories. We supply precision sensors and test equipment."}});
    await runResearch(t.step,t.service);
    const saved=t.progress.mock.calls.find(([e])=>e.page)?.[0].page;
    expect(saved?.findings.map(f=>f.kind)).toEqual(["business_role","product"]);
    expect(t.service.extract).toHaveBeenCalledOnce();
    expect(t.progress.mock.calls.at(-1)?.[0].runtime?.attempts[0].crawlId).toBe("00000000-0000-4000-8000-000000000010");
  });
  it("caps submissions and model calls while publishing sourced evidence", async () => {
    const t = setup();
    await runResearch(t.step, t.service);
    expect(t.service.submit).toHaveBeenCalledTimes(2);
    expect(t.service.extract).toHaveBeenCalledTimes(2);
    expect(
      t.progress.mock.calls.some(([e]) => e.page?.findings.length === 1),
    ).toBe(true);
    const events = t.progress.mock.calls.map(([e]) => e);
    expect(new Set(events.map((e) => e.revision)).size).toBe(events.length);
    expect(events.at(-1)?.pages).toBe(2);
  });
  it("does not repeat an ambiguous crawl submission", async () => {
    const t = setup();
    vi.mocked(t.service.submit).mockRejectedValue(new Error("timeout"));
    await runResearch(t.step, t.service);
    expect(t.service.submit).toHaveBeenCalledTimes(1);
    expect(t.service.extract).not.toHaveBeenCalled();
    expect(
      vi
        .mocked(t.step.do)
        .mock.calls.find(([name]) => name === "submit-1")?.[2],
    ).toBe(false);
    expect(t.progress.mock.calls.at(-1)?.[0].status).toBe("partial");
  });
  it("cancels the in-flight provider job when the buyer cancels", async () => {
    const t = setup();
    vi.mocked(t.step.sleep).mockImplementation(async () =>
      t.setStatus("cancelled"),
    );
    await runResearch(t.step, t.service);
    expect(t.service.cancel).toHaveBeenCalledOnce();
    expect(t.service.poll).not.toHaveBeenCalled();
    expect(t.service.extract).not.toHaveBeenCalled();
  });
  it("stops at its deadline and cancels outstanding work", async () => {
    const t = setup();
    vi.mocked(t.step.sleep).mockImplementation(async () => t.setNow(600001));
    await runResearch(t.step, t.service);
    expect(t.service.cancel).toHaveBeenCalledOnce();
    expect(t.progress.mock.calls.at(-1)?.[0].status).toBe("partial");
  });
  it("retains progress when model output fails", async () => {
    const t = setup();
    t.config.budget.maxPages = 1;
    vi.mocked(t.service.extract).mockRejectedValue(new Error("invalid JSON"));
    await runResearch(t.step, t.service);
    expect(t.progress.mock.calls.at(-1)?.[0]).toMatchObject({
      status: "partial",
      pages: 1,
      modelCalls: 1,
    });
  });
  it("respects a zero model budget", async () => {
    const t = setup();
    t.config.budget.maxModelCalls = 0;
    await runResearch(t.step, t.service);
    expect(t.service.extract).not.toHaveBeenCalled();
  });
  it("does not submit work for an already cancelled job", async () => {
    const t = setup();
    t.setStatus("cancelled");
    await runResearch(t.step, t.service);
    expect(t.service.discover).not.toHaveBeenCalled();
    expect(t.service.submit).not.toHaveBeenCalled();
  });
  it("reports failure even when provider cleanup is unavailable", async () => {
    const t = setup();
    vi.mocked(t.service.poll).mockRejectedValue(new Error("provider down"));
    vi.mocked(t.service.cancel).mockRejectedValue(new Error("provider down"));
    await runResearch(t.step, t.service);
    expect(
      t.progress.mock.calls.at(-1)?.[0].runtime?.attempts[0],
    ).toMatchObject({ status: "failed", url: t.config.seeds[0] });
  });
});

it("reads new domains before following links and checkpoints pending work", async () => {
  const t = setup();
  t.config.budget.maxDomains = 2;
  t.config.seeds.push("https://second.example.com/");
  await runResearch(t.step, t.service);
  expect(vi.mocked(t.service.submit).mock.calls.map((c) => c[0])).toEqual(
    t.config.seeds,
  );
  expect(t.progress.mock.calls.at(-1)?.[0].runtime?.remaining).toContain(
    "https://instruments.example.com/products",
  );
});
it("preserves URLs beyond the domain limit for continuation", async () => {
  const t = setup();
  t.config.seeds.push("https://second.example.com/");
  await runResearch(t.step, t.service);
  expect(t.progress.mock.calls.at(-1)?.[0].runtime?.remaining).toContain(
    "https://second.example.com/",
  );
});
it("sends only approved public research context to extraction", async () => {
  const t = setup();
  await runResearch(t.step, t.service);
  const input = JSON.parse(
    vi.mocked(t.service.extract).mock.calls[0][0][1].content,
  );
  expect(input.publicResearchTerms).toEqual(["sensors"]);
  expect(input.sourceUrl).toBe(t.config.seeds[0]);
  expect(input).not.toHaveProperty("budget");
});
it("records provider failure details against the attempted URL", async () => {
  const t = setup();
  vi.mocked(t.service.poll).mockResolvedValue({
    status: "completed",
    warning: "Crawler disallowed; HTTP 403",
  });
  await runResearch(t.step, t.service);
  expect(t.progress.mock.calls.at(-1)?.[0].runtime?.attempts[0]).toMatchObject({
    url: t.config.seeds[0],
    status: "failed",
    reason: "Crawler disallowed; HTTP 403",
  });
});

it("runs people research through the bounded worker without producing company claims", async () => {
  const t = setup();
  Object.assign(t.config, { purpose: "people", companyName: "Example Instruments", companyDomain: "instruments.example.com", targetId: "target-a" });
  t.config.budget.maxPages = 1;
  const quote = "Alex Example is Managing Director of Example Instruments.";
  vi.mocked(t.service.poll).mockResolvedValue({ status: "completed", page: { url: t.config.seeds[0], markdown: quote + " [Our team](/team) We manufacture precision sensors." } });
  vi.mocked(t.service.extract).mockResolvedValue([{ kind: "person", name: "Alex Example", value: "Managing Director", quote, website: t.config.seeds[0] }]);
  await runResearch(t.step, t.service);
  const event = t.progress.mock.calls.find(([e]) => e.page)?.[0];
  expect(event?.page?.findings.map(f => f.kind)).toEqual(["person"]);
  expect(event?.runtime?.remaining).toContain("https://instruments.example.com/team");
  expect(t.service.extract).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ content: expect.stringContaining("named business decision-makers") })]));
  expect(t.service.submit).toHaveBeenCalledOnce();
});

it("can search a supported legal operator while staying within the page budget", async () => {
  const t = setup();
  Object.assign(t.config, { purpose: "people", companyName: "Example Instruments", companyDomain: "instruments.example.com", maxPeopleSearches: 2 });
  const quote = "This site is operated by Example Holdings Pty Ltd.";
  vi.mocked(t.service.poll).mockResolvedValue({ status: "completed", page: { url: t.config.seeds[0], markdown: quote } });
  vi.mocked(t.service.extract).mockResolvedValue([{ kind: "identifier", name: "Legal entity", value: "Example Holdings Pty Ltd", quote, website: t.config.seeds[0] }]);
  t.service.peopleFollowup = vi.fn(async () => ({ seeds: ["https://instruments.example.com/team"] }));
  await runResearch(t.step, t.service);
  expect(t.service.peopleFollowup).toHaveBeenCalledOnce();
  expect(t.service.submit).toHaveBeenCalledTimes(2);
});

it("stops cleanly with saved evidence when the worker request reserve is reached", async () => {
  const t = setup();
  const original = t.service.control;
  t.service.control = vi.fn(async () => {
    const state = await original();
    return t.progress.mock.calls.some(([e]) => e.page) ? { ...state, deadline: 0, stopReason: "Worker request budget reached" } : state;
  });
  await runResearch(t.step, t.service);
  expect(t.service.submit).toHaveBeenCalledOnce();
  expect(t.progress.mock.calls.at(-1)?.[0]).toMatchObject({ status: "partial", pages: 1, message: expect.stringContaining("Worker request budget reached") });
});

it("saves labelled company facts without spending AI calls", async () => {
  const t = setup();
  Object.assign(t.config, { purpose: "firmographics", companyName: "Example Instruments", companyDomain: "instruments.example.com" });
  t.config.budget.maxPages = 1;
  vi.mocked(t.service.poll).mockResolvedValue({ status: "completed", page: { url: t.config.seeds[0], markdown: "We employ 50 employees. [About](/about)" } });
  t.service.extractHeadcount = vi.fn().mockResolvedValue({ value: "50 employees", quote: "We employ 50 employees" });
  await runResearch(t.step, t.service);
  expect(t.service.extract).not.toHaveBeenCalled();
  expect(t.service.extractHeadcount).not.toHaveBeenCalled();
  expect(t.progress.mock.calls.find(([e]) => e.page)?.[0].page?.findings[0]).toMatchObject({ kind: "headcount", value: "50 employees" });
  expect(t.progress.mock.calls.at(-1)?.[0]).toMatchObject({ pages: 1, modelCalls: 0 });
});
it("retains company facts when AI is unavailable and never invents a count", async () => {
  const t = setup(); Object.assign(t.config, { purpose: "firmographics", companyName: "Example Instruments", companyDomain: "instruments.example.com" });
  t.service.extractHeadcount = vi.fn().mockRejectedValue(new Error("provider failure"));
  vi.mocked(t.service.poll).mockResolvedValue({ status: "completed", page: { url: t.config.seeds[0], markdown: "We were founded in 2011. We are a family business." } });
  await runResearch(t.step, t.service);
  expect(t.progress.mock.calls.find(([e]) => e.page)?.[0].page?.findings.map(f => f.kind)).toEqual(["founded_year"]);
  expect(t.progress.mock.calls.at(-1)?.[0].status).toBe("complete");
});

it("saves a request-budget stop even when crawl cancellation fails", async () => {
  const t = setup();
  let checks = 0;
  vi.mocked(t.service.control).mockImplementation(async () => ({ status: "crawling", config: t.config, seeds: t.config.seeds, deadline: ++checks >= 4 ? 0 : 600000, stopReason: "Worker request budget reached" }));
  vi.mocked(t.service.cancel).mockRejectedValue(new Error("Crawler unavailable (400)"));
  await runResearch(t.step, t.service);
  expect(t.service.cancel).toHaveBeenCalledTimes(1);
  expect(t.progress.mock.calls.at(-1)?.[0]).toMatchObject({status:"partial",message:"Worker request budget reached"});
});
it("searches a discovered name after a blocked profile and continues to alternative sources",async()=>{
 const t=setup();
 Object.assign(t.config,{purpose:'people',companyName:'Example Instruments',companyDomain:'instruments.example.com',maxPeopleSearches:2,peopleSearchLeads:[{url:'https://www.linkedin.com/in/alexexample',title:'Alex Example - Director',snippet:'Director of Example Instruments',basis:'search-result',query:'query',observedAt:'2026-09-09T00:00:00Z'}]});
 vi.mocked(t.service.submit).mockRejectedValueOnce(new Error('blocked'));
 t.service.peopleFollowup=vi.fn(async()=>({seeds:['https://instruments.example.com/team']}));
 await runResearch(t.step,t.service);
 expect(t.service.peopleFollowup).toHaveBeenCalledOnce();
 expect(t.service.submit).toHaveBeenCalledTimes(2);
 expect(t.service.submit).toHaveBeenLastCalledWith('https://instruments.example.com/team');
});
it("reads individual people pages without spending requests on crawler submission and polling",async()=>{
 const t=setup(); Object.assign(t.config,{purpose:'people',companyName:'Example Instruments',companyDomain:'instruments.example.com'});t.config.budget.maxPages=1;
 t.service.readPeoplePage=vi.fn(async url=>({status:'completed',page:{url,markdown:'Example Instruments does not publish named staff on this page.'}}));
 await runResearch(t.step,t.service);
 expect(t.service.readPeoplePage).toHaveBeenCalledOnce();
 expect(t.service.submit).not.toHaveBeenCalled(); expect(t.service.poll).not.toHaveBeenCalled();
 expect(t.progress.mock.calls.at(-1)?.[0].pages).toBe(1);
});
it("uses provider admission without an additional fixed search delay", async () => {
 const t=setup(); Object.assign(t.config,{purpose:'people',companyName:'Example Instruments',companyDomain:'instruments.example.com',maxPeopleSearches:2});
 t.service.peopleFollowup=vi.fn(async()=>({seeds:[]}));
 await runResearch(t.step,t.service);
 expect(t.step.sleep).not.toHaveBeenCalledWith('people-search-spacing',21000);
 expect(t.service.peopleFollowup).toHaveBeenCalledOnce();
});
it("reserves the second search while website pages may reveal the legal operator",async()=>{
 const t=setup();Object.assign(t.config,{purpose:'people',companyName:'Example Instruments',companyDomain:'instruments.example.com',maxPeopleSearches:2});t.config.budget={maxPages:5,maxDomains:1,maxModelCalls:5,maxMinutes:10};
 vi.mocked(t.service.discover).mockResolvedValue({seeds:['https://instruments.example.com/about','https://instruments.example.com/privacy'],peopleLeadCount:0});
 vi.mocked(t.service.poll).mockImplementation(async()=>({status:'completed',page:{url:t.service.submit && vi.mocked(t.service.submit).mock.calls.at(-1)![0],markdown:'Example Instruments does not publish named staff on this page.'}}));
 t.service.peopleFollowup=vi.fn(async()=>{expect(t.service.submit).toHaveBeenCalledTimes(3);return{seeds:[]};});
 await runResearch(t.step,t.service);expect(t.service.peopleFollowup).toHaveBeenCalledOnce();
});

it("falls back once on blocked content, validates the result, and respects the original page budget", async () => {
  const t = setup(); t.config.budget.maxPages = 1;
  vi.mocked(t.service.poll).mockResolvedValue({ status: "completed", page: { url: t.config.seeds[0], markdown: '---\ntitle: "Access to this page has been denied"\nmeta: px-captcha\n---' } });
  t.service.readFallbackPage = vi.fn(async () => ({ status: "completed", page: { url: t.config.seeds[0], markdown: "Example Instruments makes sensors. Contact us for our product catalogue." } }));
  await runResearch(t.step, t.service);
  expect(t.service.readFallbackPage).toHaveBeenCalledOnce();
  expect(t.service.extract).toHaveBeenCalledOnce();
  expect(t.progress.mock.calls.at(-1)?.[0]).toMatchObject({ pages: 1 });
});
it("does not extract or count blocked fallback responses as read pages", async () => {
  const t = setup(); t.config.budget.maxPages = 1;
  vi.mocked(t.service.poll).mockResolvedValue({ status: "failed" });
  t.service.readFallbackPage = vi.fn(async () => ({ status: "completed", page: { url: t.config.seeds[0], markdown: "" } }));
  await runResearch(t.step, t.service);
  expect(t.service.extract).not.toHaveBeenCalled();
  expect(t.progress.mock.calls.at(-1)?.[0].pages).toBe(0);
});

it("runs one bounded missing-field follow-up and retains direct team evidence within the model limit",async()=>{
 const t=setup();Object.assign(t.config,{purpose:"people",targetedFollowup:true,companyName:"Example Instruments",companyDomain:"instruments.example.com",maxPeopleSearches:2});
 t.config.budget={maxPages:3,maxDomains:1,maxMinutes:10,maxModelCalls:2};
 t.service.planFollowup=vi.fn(async()=>({choice:"search_people"}));
 t.service.targetedSearch=vi.fn(async()=>({seeds:["https://instruments.example.com/team"]}));
 vi.mocked(t.service.extract).mockResolvedValue([]);
 vi.mocked(t.service.poll).mockImplementation(async()=>({status:"completed",page:{url:t.progress.mock.calls.at(-1)?.[0].runtime?.attempts.at(-1)?.url||t.config.seeds[0],markdown:t.progress.mock.calls.at(-1)?.[0].runtime?.attempts.at(-1)?.url.endsWith('/team')?"# Our team\n#### Alex Example\n##### CEO":"Example Instruments builds precision sensors for industry."}}));
 await runResearch(t.step,t.service);
 expect(t.service.planFollowup).toHaveBeenCalledOnce();
 expect(vi.mocked(t.service.targetedSearch).mock.calls.map(([field]) => field)).toEqual([...Array(10).fill("people"), "email", "email"]);
 expect(t.progress.mock.calls.at(-1)?.[0].modelCalls).toBeLessThanOrEqual(2);
 expect(t.progress.mock.calls.some(([e])=>e.page?.findings.some(f=>f.name==="Alex Example"))).toBe(true);
});
it("checks cancellation before targeted model or search calls",async()=>{
 const t=setup();Object.assign(t.config,{purpose:"people",targetedFollowup:true,companyName:"Example Instruments",companyDomain:"instruments.example.com",maxPeopleSearches:2});
 t.service.planFollowup=vi.fn(async()=>({choice:"search_people"}));t.service.targetedSearch=vi.fn(async()=>({seeds:[]}));
 vi.mocked(t.service.extract).mockImplementation(async()=>{t.setStatus("cancelled");return []});
 await runResearch(t.step,t.service);
 expect(t.service.planFollowup).not.toHaveBeenCalled();expect(t.service.targetedSearch).not.toHaveBeenCalled();
});

it("retains the predefined search when the AI planner quota is exhausted",async()=>{
 const t=setup();Object.assign(t.config,{purpose:"firmographics",targetedFollowup:true,companyName:"Example Instruments",companyDomain:"instruments.example.com"});
 t.service.planFollowup=vi.fn(async()=>{throw new Error("AI quota exceeded")});
 t.service.targetedSearch=vi.fn(async()=>({seeds:[]}));
 await runResearch(t.step,t.service);
 expect(t.service.planFollowup).toHaveBeenCalledOnce();expect(t.service.targetedSearch).toHaveBeenCalled();
 expect(vi.mocked(t.service.targetedSearch).mock.calls.length).toBeLessThanOrEqual(8);
 expect(t.progress.mock.calls.at(-1)?.[0].message).toContain("predefined company follow-up");
});

it("does not spend AI calls on an explicit company team card",async()=>{
 const t=setup();Object.assign(t.config,{purpose:"people",targetedFollowup:true,companyName:"Example Instruments",companyDomain:"instruments.example.com"});
 t.service.planFollowup=vi.fn(async()=>({choice:"stop"}));
 vi.mocked(t.service.poll).mockResolvedValue({status:"completed",page:{url:t.config.seeds[0],markdown:"# Our team\n#### Alex Example\n##### CEO"}});
 await runResearch(t.step,t.service);
 expect(t.service.extract).not.toHaveBeenCalled();expect(t.service.planFollowup).not.toHaveBeenCalled();
 expect(t.progress.mock.calls.at(-1)?.[0].modelCalls).toBe(0);
 expect(t.progress.mock.calls.some(([e])=>e.page?.findings.some(f=>f.name==="Alex Example"))).toBe(true);
});

describe("new business target", () => {
  it.each(['website', 'page'] as const)('finishes the admitted %s evidence budget after the root goal is reached', async researchTask => {
    const { config, service, step, progress } = setup();
    Object.assign(config, { mode: 'automatic', workflow: 'business', researchTask, researchRunId: 'root', companyDomain: 'instruments.example.com', discoveryCandidate: researchTask === 'website', targetBusinesses: 1, newBusinessIds: ['already-saved'] });
    config.budget = { maxPages: 1, maxDomains: 1, maxMinutes: 10, maxModelCalls: 1 };
    service.readPage = vi.fn(async url => ({ status: 'completed', page: { url, markdown: 'Example Instruments makes sensors. [Sensor products](/products)' } }));
    await runResearch(step, service);
    expect(service.readPage).toHaveBeenCalledTimes(1);
    expect(service.extract).toHaveBeenCalledTimes(1);
    expect(progress.mock.calls.flatMap(([event]) => event.page?.findings || [])).toContainEqual(expect.objectContaining({ kind: 'company', name: 'Example Instruments' }));
    expect(progress.mock.calls.at(-1)?.[0]).toMatchObject({ pages: 1, modelCalls: 1 });
    expect(progress.mock.calls.at(-1)?.[0].message).not.toContain('target reached');
  });
  it("stops before crawling when discovery has reached the distinct business target", async () => {
    const { config, service, step, progress } = setup();
    config.targetBusinesses = 2;
    config.newBusinessIds = ["one", "two", "two"];
    await runResearch(step, service);
    expect(service.submit).not.toHaveBeenCalled();
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ status: "complete", message: expect.stringContaining("2 of 2 new businesses found") }));
  });
  it("does not count repeated business IDs as new businesses", async () => {
    const { config, service, step, progress } = setup();
    config.targetBusinesses = 2;
    config.newBusinessIds = ["one", "one"];
    await runResearch(step, service);
    expect(service.submit).toHaveBeenCalled();
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ status: "partial", message: expect.stringContaining("1 of 2 new businesses found") }));
  });
  it("stops after a newly saved business reaches the target", async () => {
    const { config, service, step, progress } = setup();
    config.targetBusinesses = 1;
    progress.mockImplementation(async event => {
      if (event.page) config.newBusinessIds = ["new-business"];
    });
    await runResearch(step, service);
    expect(service.submit).toHaveBeenCalledTimes(1);
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ status: "complete", message: expect.stringContaining("1 of 1 new businesses found") }));
  });
});

it("explains empty extraction without logging page content or URL query secrets", async () => {
  const t = setup();
  t.config.seeds = ["https://instruments.example.com/?token=private"];
  t.config.budget.maxPages = 1;
  t.service.diagnostic = vi.fn();
  vi.mocked(t.service.extract).mockResolvedValue([]);
  await runResearch(t.step, t.service);
  expect(t.service.diagnostic).toHaveBeenCalledWith(expect.objectContaining({ event: "extraction_result", candidates: 0, accepted: 0, reason: "model_returned_no_evidence" }));
  expect(t.service.diagnostic).toHaveBeenCalledWith(expect.objectContaining({ event: "run_finished", reason: "page_budget_reached" }));
  const log = JSON.stringify(vi.mocked(t.service.diagnostic).mock.calls);
  expect(log).not.toContain("token=");
  expect(log).not.toContain("Example Instruments makes sensors");
});

it("honours the planner stop action and retains unread sources", async () => {
  const t = setup();
  Object.assign(t.config, { purpose: "people", targetedFollowup: true, companyName: "Example Instruments", companyDomain: "instruments.example.com", maxPeopleSearches: 2 });
  t.config.budget.maxPages = 4;
  t.service.planFollowup = vi.fn(async () => ({ choice: "stop" }));
  vi.mocked(t.service.extract).mockResolvedValue([]);
  vi.mocked(t.service.poll).mockResolvedValue({ status: "completed", page: { url: t.config.seeds[0], markdown: "Example Instruments manufactures sensors. [About](/about) [Contact](/contact)" } });
  await runResearch(t.step, t.service);
  expect(t.service.poll).toHaveBeenCalledOnce();
  expect(t.progress.mock.calls.at(-1)?.[0].runtime?.remaining.length).toBeGreaterThan(0);
  expect(t.progress.mock.calls.at(-1)?.[0].message).toContain("No useful targeted follow-up selected");
});

it("continues automatic company detail research when headcount is found but revenue is missing", async () => {
  const t = setup();
  Object.assign(t.config, { mode: "automatic", purpose: "firmographics", companyName: "Example Instruments", companyDomain: "instruments.example.com" });
  t.config.budget.maxPages = 12;
  vi.mocked(t.service.poll).mockResolvedValue({ status: "completed", page: { url: t.config.seeds[0], markdown: "Example Instruments makes sensors. We employ 50 employees. [About](/about) [Contact](/contact)" } });
  await runResearch(t.step, t.service);
  expect(t.service.poll).toHaveBeenCalledTimes(3);
  expect(t.progress.mock.calls.find(([e]) => e.page)?.[0].page?.findings.some(f => f.kind === "headcount")).toBe(true);
});

it("keeps searching for a missing headcount after reading team pages, capturing named leaders on the way", async () => {
  // Anonymised regression of a casket manufacturer whose own site never states headcount.
  const t = setup();
  Object.assign(t.config, { mode: "automatic", purpose: "firmographics", targetedFollowup: true, companyName: "Example Caskets", companyDomain: "caskets.example.com", seeds: ["https://caskets.example.com/"] });
  t.config.budget = { maxPages: 8, maxDomains: 4, maxMinutes: 10, maxModelCalls: 6 };
  const pages: Record<string, string> = {
    "https://caskets.example.com/": "# Example Caskets\nExample Caskets manufactures caskets and coffins. [About](/about/) [Our team](/about/our-team/)",
    "https://caskets.example.com/about/": "# About\nWe are proud of our national reach. [Our team](/about/our-team/)",
    "https://caskets.example.com/about/our-team/": "# Meet our team\nOur team members are our strength.\n\nJane Citizen\nManaging Director\nAlex Example\nGeneral Manager of Operations\n[0400 000 000](tel:0400%20000%20000) alexe@caskets.example.com\n",
    "https://www.datanyze.com/companies/example-caskets/123": "# Example Caskets\nWebsite\n[www.caskets.example.com](//www.caskets.example.com)\n### Employees\n98\n### Founded\n1973",
  };
  t.service.readPage = vi.fn(async url => ({ status: "completed", page: { url, markdown: pages[url] || "" } }));
  t.service.planFollowup = vi.fn(async () => ({ choice: "read_0" }));
  t.service.targetedSearch = vi.fn(async (_field, round) => ({ seeds: round === 1 ? [] : ["https://www.datanyze.com/companies/example-caskets/123"], exhausted: round >= 2 }));
  await runResearch(t.step, t.service);
  expect(t.service.planFollowup).toHaveBeenCalledOnce();
  // Choosing to read did not consume the search; searching continued until evidence appeared.
  expect(t.service.targetedSearch).toHaveBeenCalledTimes(3);
  const saved = t.progress.mock.calls.flatMap(([e]) => e.page?.findings || []);
  expect(saved.some(f => f.kind === "headcount" && f.value === "98")).toBe(true);
  expect(saved.filter(f => f.kind === "person").map(f => [f.name, f.email])).toEqual([["Jane Citizen", undefined], ["Alex Example", "alexe@caskets.example.com"]]);
  expect(t.progress.mock.calls.at(-1)?.[0]).toMatchObject({ status: "partial" });
  expect(t.progress.mock.calls.at(-1)?.[0].message).toContain("revenue remains unknown");
});

it("stops the follow-up loop once the search ladder is exhausted and reports the field as unknown", async () => {
  const t = setup();
  Object.assign(t.config, { purpose: "firmographics", targetedFollowup: true, companyName: "Example Caskets", companyDomain: "caskets.example.com", seeds: ["https://caskets.example.com/"] });
  t.config.budget = { maxPages: 8, maxDomains: 4, maxMinutes: 10, maxModelCalls: 6 };
  t.service.readPage = vi.fn(async url => ({ status: "completed", page: { url, markdown: "# Example Caskets\nWe make caskets. [About](/about/)" } }));
  t.service.planFollowup = vi.fn(async () => ({ choice: "stop" }));
  t.service.targetedSearch = vi.fn(async (_field, round) => ({ seeds: [], exhausted: round >= 3 }));
  await runResearch(t.step, t.service);
  expect(t.service.targetedSearch).toHaveBeenCalledTimes(4);
  expect(vi.mocked(t.service.readPage).mock.calls.length).toBeLessThanOrEqual(3);
  expect(t.progress.mock.calls.at(-1)?.[0].message).toContain("headcount remains unknown");
});

it("asks the model to locate a headcount on an identity-matched profile that has no labelled count, and keeps only a verbatim statement", async () => {
  const t = setup();
  Object.assign(t.config, { mode: "automatic", purpose: "firmographics", targetedFollowup: true, companyName: "Example Caskets", companyDomain: "caskets.example.com", seeds: ["https://profiles.example.net/company/example-caskets"] });
  t.config.budget = { maxPages: 4, maxDomains: 4, maxMinutes: 10, maxModelCalls: 4 };
  const page = "# Example Caskets\nExample Caskets is a family business with a dedicated team of 35 staff across two sites. Followers 900.";
  t.service.readPage = vi.fn(async url => ({ status: "completed", page: { url, markdown: page } }));
  t.service.extractHeadcount = vi.fn(async () => ({ value: "35 staff", quote: "a dedicated team of 35 staff across two sites" }));
  await runResearch(t.step, t.service);
  expect(t.service.extractHeadcount).toHaveBeenCalledOnce();
  const saved = t.progress.mock.calls.flatMap(([e]) => e.page?.findings || []);
  expect(saved.find(f => f.kind === "headcount")).toMatchObject({ value: "35 staff", factMetadata: { basis: "third_party_estimate" } });
  expect(t.progress.mock.calls.at(-1)?.[0].status).toBe("partial");
  // An invented statement is discarded and the loop continues.
  const u = setup();
  Object.assign(u.config, { purpose: "firmographics", targetedFollowup: true, companyName: "Example Caskets", companyDomain: "caskets.example.com", seeds: ["https://profiles.example.net/company/example-caskets"] });
  u.config.budget = { maxPages: 2, maxDomains: 2, maxMinutes: 10, maxModelCalls: 2 };
  u.service.readPage = vi.fn(async url => ({ status: "completed", page: { url, markdown: page } }));
  u.service.extractHeadcount = vi.fn(async () => ({ value: "900", quote: "Followers 900" }));
  await runResearch(u.step, u.service);
  expect(u.progress.mock.calls.flatMap(([e]) => e.page?.findings || []).some(f => f.kind === "headcount")).toBe(false);
});

it("skips the remaining pages of a host that returned no content, instead of spending the page budget on it", async () => {
  const t = setup();
  Object.assign(t.config, { purpose: "firmographics", targetedFollowup: true, companyName: "Example Caskets", companyDomain: "caskets.example.com", seeds: ["https://caskets.example.com/"] });
  t.config.budget = { maxPages: 6, maxDomains: 6, maxMinutes: 10, maxModelCalls: 2 };
  t.service.readPage = vi.fn(async url => url.includes("blocked.example.net") ? { status: "failed", warning: "no content" } : { status: "completed", page: { url, markdown: "# Example Caskets\nWe make caskets." } });
  t.service.planFollowup = vi.fn(async () => ({ choice: "search_size" }));
  t.service.targetedSearch = vi.fn(async () => ({ seeds: ["https://blocked.example.net/company/a", "https://blocked.example.net/company/b", "https://blocked.example.net/company/c", "https://www.linkedin.com/in/someone"], exhausted: true }));
  await runResearch(t.step, t.service);
  const attempted = vi.mocked(t.service.readPage).mock.calls.map(c => c[0]);
  expect(attempted.filter(u => u.includes("blocked.example.net"))).toHaveLength(1);
  expect(attempted.some(u => u.includes("linkedin.com/in/"))).toBe(false);
});

it("skips websites already attached to the mandate and caps pages per website during discovery", async () => {
  const t = setup();
  Object.assign(t.config, { workflow: "business", skipDomains: ["known.example.com"], seeds: ["https://known.example.com/", "https://fresh.example.com/"] });
  t.config.budget = { maxPages: 6, maxDomains: 6, maxMinutes: 10, maxModelCalls: 6 };
  const links = Array.from({ length: 5 }, (_, i) => `[Products ${i}](/products-${i})`).join(" ");
  t.service.readPage = vi.fn(async url => ({ status: "completed", page: { url, markdown: `Fresh Example makes sensors. ${links}` } }));
  vi.mocked(t.service.extract).mockResolvedValue([]);
  await runResearch(t.step, t.service);
  const attempted = vi.mocked(t.service.readPage).mock.calls.map(c => c[0]);
  expect(attempted.some(u => u.includes("known.example.com"))).toBe(false);
  expect(attempted.filter(u => u.includes("fresh.example.com"))).toHaveLength(2);
  // Two pages without company or product evidence: the rest of that website is dropped.
  expect(t.progress.mock.calls.at(-1)?.[0].runtime?.remaining).toEqual([]);
  // With evidence, the remaining pages are carried to the next batch instead.
  const u = setup();
  Object.assign(u.config, { workflow: "business", seeds: ["https://fresh.example.com/"] });
  u.config.budget = { maxPages: 6, maxDomains: 6, maxMinutes: 10, maxModelCalls: 6 };
  u.service.readPage = vi.fn(async url => ({ status: "completed", page: { url, markdown: `Fresh Example makes sensors. ${links}` } }));
  vi.mocked(u.service.extract).mockResolvedValue([{ kind: "company", name: "Fresh Example", value: "Fresh Example makes sensors", quote: "Fresh Example makes sensors.", website: "https://fresh.example.com/" }]);
  await runResearch(u.step, u.service);
  expect(vi.mocked(u.service.readPage).mock.calls).toHaveLength(2);
  expect(u.progress.mock.calls.at(-1)?.[0].runtime?.remaining.length).toBeGreaterThan(0);
  expect(u.progress.mock.calls.at(-1)?.[0].message).toContain("Per-website page limit");
});

it("collects web discovery delivered in slices before reading pages", async () => {
  const t = setup();
  Object.assign(t.config, { workflow: "business", discover: true, seeds: [] });
  t.config.budget = { maxPages: 4, maxDomains: 4, maxMinutes: 10, maxModelCalls: 4 };
  const slices = [{ seeds: ["https://one.example.com/"], more: true }, { seeds: ["https://two.example.com/"], more: true }, { seeds: ["https://three.example.com/"], more: false }];
  t.service.discover = vi.fn(async () => slices.shift()!);
  t.service.readPage = vi.fn(async url => ({ status: "completed", page: { url, markdown: "Example makes sensors." } }));
  vi.mocked(t.service.extract).mockResolvedValue([]);
  await runResearch(t.step, t.service);
  expect(t.service.discover).toHaveBeenCalledTimes(3);
  expect(vi.mocked(t.service.readPage).mock.calls.map(c => c[0])).toEqual(["https://one.example.com/", "https://two.example.com/", "https://three.example.com/"]);
});

it('retains a general manager and continues to find an owner in automatic research', async () => {
 const t = setup();
 Object.assign(t.config, {mode:'automatic',purpose:'people',targetedFollowup:true,maxPeopleSearches:2,companyName:'Example Instruments',companyDomain:'instruments.example.com'});
 t.config.budget={maxPages:4,maxDomains:2,maxModelCalls:0,maxMinutes:10};
 t.service.readPage=vi.fn(async url=>({status:'completed',page:{url,markdown:url.endsWith('/owner') ? '# Our team\n#### Alex Sampleson\n##### Owner\nalex@instruments.example.com' : '# Our team\n#### Casey Citizen\n##### General Manager\ncasey@instruments.example.com'}}));
 t.service.targetedSearch=vi.fn(async()=>({seeds:['https://instruments.example.com/owner'],exhausted:true}));
 await runResearch(t.step,t.service);
 expect(t.service.targetedSearch).toHaveBeenCalledWith('people',1);
 const saved=t.progress.mock.calls.flatMap(([event])=>event.page?.findings||[]);
 expect(saved.map(f=>f.name)).toEqual(expect.arrayContaining(['Casey Citizen','Alex Sampleson']));
 expect(t.progress.mock.calls.at(-1)?.[0].status).toBe('complete');
});
it('carries a newly evidenced legal operator into directory extraction and reopens its searches', async () => {
 const t=setup();
 Object.assign(t.config,{purpose:'people',targetedFollowup:true,maxPeopleSearches:2,companyName:'Example Instruments',companyDomain:'instruments.example.com'});
 t.config.budget={maxPages:4,maxDomains:2,maxModelCalls:4,maxMinutes:10};
 const profile='https://www.dnb.com/business-directory/company-profiles/example-holdings.123/contacts';
 const legal='This website is operated by Example Holdings Pty Ltd.';
 const person='# Example Holdings Pty Ltd\nContacts\nAlex Example\nDirector';
 t.service.readPage=vi.fn(async url=>({status:'completed',page:{url,markdown:url.endsWith('/privacy')?legal:url===profile?person:'Example Instruments builds precision sensors.'}}));
 t.service.extract=vi.fn(async messages=>{
  const context=JSON.parse(messages[1].content);
  if(context.source.endsWith('/privacy'))return [{kind:'identifier',name:'Legal entity',value:'Example Holdings Pty Ltd',quote:legal,website:context.source}];
  if(context.source===profile){expect(context.legalEntity).toBe('Example Holdings Pty Ltd');return [{kind:'person',name:'Alex Example',value:'Director',quote:person,website:profile}];}
  return [];
 });
 t.service.targetedSearch=vi.fn().mockResolvedValueOnce({seeds:['https://instruments.example.com/privacy'],exhausted:true}).mockResolvedValueOnce({seeds:[profile],exhausted:true}).mockResolvedValue({seeds:[],exhausted:true});
 await runResearch(t.step,t.service);
 expect(vi.mocked(t.service.targetedSearch).mock.calls.map(([field])=>field).slice(0,2)).toEqual(['people','people']);
 expect(t.progress.mock.calls.flatMap(([event])=>event.page?.findings||[])).toEqual(expect.arrayContaining([expect.objectContaining({name:'Alex Example',value:'Director'})]));
});

it('lets the discovery coordinator finish its searches without rereading delegated seeds', async () => {
  const t = setup();
  Object.assign(t.config, { mode: 'automatic', workflow: 'business', parallelDiscovery: true, targetBusinesses: 20 });
  t.service.readPage = vi.fn();
  await runResearch(t.step, t.service);
  expect(t.service.readPage).not.toHaveBeenCalled();
  expect(t.service.submit).not.toHaveBeenCalled();
  expect(t.progress.mock.calls.at(-1)?.[0]).toMatchObject({ status: 'complete', pages: 0 });
  expect(t.progress.mock.calls.at(-1)?.[0].message).toContain('researched in parallel');
});
it('persists prepared discovery sources in durable batches before spending search rounds', async () => {
  const t = setup();
  Object.assign(t.config, { discover: true, workflow: 'business', parallelDiscovery: true, targetBusinesses: 20 });
  const events: string[] = [];
  t.service.prepareDiscoverySources = vi.fn(async () => { events.push('prepare'); return { pending: true }; });
  t.service.persistDiscoverySources = vi.fn()
    .mockImplementationOnce(async () => { events.push('persist-1'); return { pending: true }; })
    .mockImplementationOnce(async () => { events.push('persist-2'); return { pending: false }; });
  t.service.discover = vi.fn(async () => { events.push('search'); return { seeds: [] }; });
  await runResearch(t.step, t.service);
  expect(events).toEqual(['prepare', 'persist-1', 'persist-2', 'search']);
  expect(vi.mocked(t.step.do).mock.calls.map(([name]) => name)).toEqual(expect.arrayContaining([
    'discovery-sources',
    'discovery-persist-0',
    'discovery-persist-1',
    'discover',
  ]));
});
it('uses a cached page before reserving another browser request', async () => {
  const t = setup(); t.config.budget.maxPages = 1;
  t.service.cachedPage = vi.fn(async url => ({ status: 'completed', page: { url, markdown: 'Example Instruments makes sensors for manufacturers. We supply industrial sensors and calibration equipment throughout Australia.' } }));
  t.service.readPage = vi.fn();
  await runResearch(t.step, t.service);
  expect(t.service.cachedPage).toHaveBeenCalledOnce();
  expect(t.service.readPage).not.toHaveBeenCalled();
  expect(t.progress.mock.calls.at(-1)?.[0].pages).toBe(1);
});
it('finishes an objective already supported by sibling evidence without another page or model call', async () => {
  const t = setup();
  Object.assign(t.config, { mode: 'automatic', purpose: 'people', companyDomain: 'instruments.example.com', companyName: 'Example Instruments', targetedFollowup: true });
  const original = t.service.control;
  t.service.control = vi.fn(async () => ({ ...await original(), findings: [{ kind: 'person' as const, name: 'Alex Example', value: 'Director', email: 'alex@instruments.example.com', quote: 'Alex Example Director', website: t.config.seeds[0] }] }));
  t.service.readPage = vi.fn();
  await runResearch(t.step, t.service);
  expect(t.service.readPage).not.toHaveBeenCalled();
  expect(t.service.extract).not.toHaveBeenCalled();
  expect(t.progress.mock.calls.at(-1)?.[0]).toMatchObject({ status: 'complete', pages: 0 });
});

it("replans discovery from fresh feedback and counts planning calls against the model budget", async () => {
  const t = setup();
  Object.assign(t.config, { adaptiveDiscovery: true, workflow: 'business', discover: true, parallelDiscovery: true, seeds: [] });
  const context = { scope: "industrial cleaning", startingTerms: [], regions: ["Victoria"], target: 20, found: 0, remainingSearches: 12, attempts: [], candidates: [] };
  t.service.discoveryContext = vi.fn().mockResolvedValueOnce(context).mockResolvedValue({ ...context, remainingSearches: 11, attempts: [{ query: "cleaners Victoria", status: "succeeded", newDomains: 0 }] });
  const decision = { query: "decontamination contractors", region: "Victoria", reason: "Explore a different service", stop: false };
  t.service.planDiscovery = vi.fn().mockResolvedValue(decision);
  t.service.discover = vi.fn().mockResolvedValueOnce({ seeds: [], more: true }).mockResolvedValue({ seeds: [], more: false });
  await runResearch(t.step, t.service);
  expect(t.service.planDiscovery).toHaveBeenCalledTimes(2);
  expect(vi.mocked(t.service.planDiscovery).mock.calls[1][0].attempts[0].newDomains).toBe(0);
  expect(t.service.discover).toHaveBeenLastCalledWith({ planning: decision, attemptIndex: 1 });
  expect(t.progress.mock.calls.at(-1)?.[0].modelCalls).toBe(2);
});
it("falls back without exceeding the planner budget or disrupting discovery on AI failure", async () => {
  const t = setup();
  Object.assign(t.config, { adaptiveDiscovery: true, workflow: 'business', discover: true, parallelDiscovery: true, seeds: [] });
  t.config.budget.maxModelCalls = 1;
  t.service.discoveryContext = vi.fn().mockResolvedValue({ scope: "cleaning", startingTerms: [], regions: ["Victoria"], target: 20, found: 0, remainingSearches: 12, attempts: [], candidates: [] });
  t.service.planDiscovery = vi.fn().mockRejectedValue(new Error("AI unavailable"));
  t.service.discover = vi.fn().mockResolvedValueOnce({ seeds: [], more: true }).mockResolvedValue({ seeds: [], more: false });
  await runResearch(t.step, t.service);
  expect(t.service.planDiscovery).toHaveBeenCalledTimes(1);
  expect(t.service.discover).toHaveBeenCalledTimes(2);
  expect(t.progress.mock.calls.at(-1)?.[0].modelCalls).toBe(1);
});

it("preserves pages for continuation when the fallback reader is busy", async () => {
  const t = setup(); t.config.budget.maxPages = 1;
  vi.mocked(t.service.poll).mockResolvedValue({ status: "failed" });
  t.service.readFallbackPage = vi.fn(async () => ({ status: "failed", deferred: true, retryAfterMs: 30000 }));
  await runResearch(t.step, t.service);
  expect(t.service.extract).not.toHaveBeenCalled();
  const last = t.progress.mock.calls.at(-1)?.[0];
  expect(last).toMatchObject({ status: "partial", pages: 0 });
  expect(last?.runtime?.remaining).toContain(t.config.seeds[0]);
  expect(last?.runtime?.attempts[0].status).toBe("pending");
  expect(t.step.sleep).toHaveBeenCalledWith("fallback-backoff-1", 30000);
});
it('serves robots and sitemap documents from the run cache before asking for a provider read', async () => {
  const t = setup();
  Object.assign(t.config, { mode: 'automatic', purpose: 'people', targetedFollowup: false, companyName: 'Example Instruments', companyDomain: 'instruments.example.com' });
  t.config.budget = { maxPages: 1, maxDomains: 1, maxMinutes: 10, maxModelCalls: 0 };
  t.service.readPage = vi.fn(async url => ({ status: 'completed', page: { url, markdown: '# Example Instruments\nOur team\n\nJane Citizen, Managing Director' } }));
  t.service.cachedPage = vi.fn(async url => url.endsWith('/robots.txt') ? { status: 'completed', page: { url, markdown: 'Sitemap: https://instruments.example.com/sitemap.xml' } } : url.endsWith('/sitemap.xml') ? { status: 'completed', page: { url, markdown: '<urlset><url><loc>https://instruments.example.com/team/</loc></url></urlset>' } } : null);
  t.service.readSiteFile = vi.fn(async url => ({ status: 'completed', page: { url, markdown: '' } }));
  await runResearch(t.step, t.service);
  expect(t.service.cachedPage).toHaveBeenCalledWith('https://instruments.example.com/robots.txt');
  expect(t.service.cachedPage).toHaveBeenCalledWith('https://instruments.example.com/sitemap.xml');
  expect(t.service.readSiteFile).not.toHaveBeenCalled();
  expect(t.progress.mock.calls.at(-1)?.[0].runtime?.remaining).toContain('https://instruments.example.com/team/');
});
it('publishes the browser-wait notice as a heartbeat rather than once per page', async () => {
  const t = setup();
  t.config.seeds = ['https://a.example.com/', 'https://b.example.com/', 'https://c.example.com/'];
  t.config.budget = { maxPages: 3, maxDomains: 3, maxMinutes: 10, maxModelCalls: 0 };
  t.service.readPage = vi.fn(async url => ({ status: 'completed', page: { url, markdown: 'Example Instruments makes sensors for industry.' } }));
  await runResearch(t.step, t.service);
  const waiting = t.progress.mock.calls.filter(([event]) => event.message.startsWith('Waiting for browser slot'));
  expect(waiting).toHaveLength(1);
  expect(t.progress.mock.calls.at(-1)?.[0]).toMatchObject({ status: 'complete', pages: 3 });
});

it.each([false, true])('overlaps and durably checkpoints lookahead exactly once with coalescing=%s', async enabled => {
  const t = setup();
  t.config.performanceFlags = { progressCoalescing: enabled };
  Object.assign(t.config, { purpose: 'people', companyName: 'Example Instruments', companyDomain: 'instruments.example.com' });
  t.service.pageLookahead = true;
  let signalRead!: () => void;
  const nextReadStarted = new Promise<void>(resolve => { signalRead = resolve; });
  let extracting = false;
  let signalExtraction!: () => void;
  const extractionStarted = new Promise<void>(resolve => { signalExtraction = resolve; });
  t.service.readPage = vi.fn(async url => {
    if (url.endsWith('/leadership')) {
      signalRead();
      await extractionStarted;
      expect(extracting).toBe(true);
      return { status: 'completed', page: { url, markdown: '# Our team\n#### Alex Example\n##### Managing Director' } };
    }
    return { status: 'completed', page: { url, markdown: '# Our team\n[Leadership](/leadership)' } };
  });
  t.service.extract = vi.fn(async () => {
    extracting = true;
    signalExtraction();
    await nextReadStarted;
    await Promise.resolve();
    extracting = false;
    return [];
  });
  await runResearch(t.step, t.service);
  expect(t.service.readPage).toHaveBeenCalledTimes(2);
  expect(t.progress.mock.calls.at(-1)?.[0]).toMatchObject({ pages: 2 });
  expect(t.progress.mock.calls.flatMap(([event]) => event.page?.findings || []).some(f => f.name === 'Alex Example')).toBe(true);
  expect(t.progress.mock.calls.find(([event]) => event.page?.url === t.config.seeds[0])?.[0].runtime?.bufferedPage?.url).toBe('https://instruments.example.com/leadership');
}, 1000);

it('never starts lookahead beyond the page allowance', async () => {
  const t = setup();
  Object.assign(t.config, { purpose: 'people', companyName: 'Example Instruments', companyDomain: 'instruments.example.com' });
  t.config.budget.maxPages = 1;
  t.service.pageLookahead = true;
  t.service.readPage = vi.fn(async url => ({ status: 'completed', page: { url, markdown: '# Our team\n[Leadership](/leadership)' } }));
  t.service.extract = vi.fn(async () => []);
  await runResearch(t.step, t.service);
  expect(t.service.readPage).toHaveBeenCalledTimes(1);
  expect(t.progress.mock.calls.at(-1)?.[0].runtime?.remaining).toContain('https://instruments.example.com/leadership');
});

it('reuses buffered checkpoint content on continuation without another provider read', async () => {
  const t = setup();
  const url = 'https://instruments.example.com/leadership';
  Object.assign(t.config, { purpose: 'people', companyName: 'Example Instruments', companyDomain: 'instruments.example.com', runtime: { remaining: [url], visited: [t.config.seeds[0]], attempts: [], bufferedPage: { url, page: { url, markdown: '# Our team\n#### Alex Example\n##### Managing Director', observedAt: '2026-09-30T00:00:00.000Z' } } } });
  t.service.readPage = vi.fn();
  await runResearch(t.step, t.service);
  expect(t.service.readPage).not.toHaveBeenCalled();
  expect(t.service.extract).not.toHaveBeenCalled();
  expect(t.progress.mock.calls.find(([event]) => event.page)?.[0].page?.observedAt).toBe('2026-09-30T00:00:00.000Z');
});

it('plans a batch once and gives concurrent discovery calls distinct operation permits', async () => {
  const t = setup();
  Object.assign(t.config, { adaptiveDiscovery: true, workflow: 'business', discover: true, parallelDiscovery: true, seeds: [] });
  t.service.discoveryBatch = true;
  t.service.discoveryContext = vi.fn().mockResolvedValue({ scope: 'industrial services', startingTerms: [], regions: ['Victoria'], target: 20, found: 0, remainingSearches: 2, attempts: [], candidates: [] });
  t.service.planDiscovery = vi.fn().mockResolvedValue({ decisions: ['cleaning', 'calibration'].map(query => ({ query, region: 'Victoria', reason: 'Cover separate sectors', stop: false })) });
  let release!: () => void;
  const bothStarted = new Promise<void>(resolve => { release = resolve; });
  let active = 0;
  t.service.discover = vi.fn(async (_query, permit) => {
    expect(permit).toMatch(/^discover-0-q-/);
    if (++active === 2) release();
    await bothStarted;
    return { seeds: [], more: false };
  });
  t.step.do = vi.fn(async (name, run) => run({ reservation: name }));
  await runResearch(t.step, t.service);
  expect(t.service.planDiscovery).toHaveBeenCalledTimes(1);
  expect(t.service.discover).toHaveBeenCalledTimes(2);
  const permits = vi.mocked(t.service.discover).mock.calls.map(([, permit]) => permit);
  expect(new Set(permits).size).toBe(2);
}, 1000);

it.each([false, true])('joins lookahead on cancellation during extraction with coalescing=%s', async enabled => {
  const t = setup();
  t.config.performanceFlags = { progressCoalescing: enabled };
  Object.assign(t.config, { purpose: 'people', companyName: 'Example Instruments', companyDomain: 'instruments.example.com' });
  t.service.pageLookahead = true;
  let releaseRead!: () => void;
  const readGate = new Promise<void>(resolve => { releaseRead = resolve; });
  let joined = false;
  t.service.readPage = vi.fn(async url => {
    if (url.endsWith('/leadership')) {
      await readGate;
      joined = true;
    }
    return { status: 'completed', page: { url, markdown: '# Our team\n[Leadership](/leadership)' } };
  });
  t.service.extract = vi.fn(async () => {
    t.setStatus('cancelled');
    releaseRead();
    return [];
  });
  await runResearch(t.step, t.service);
  expect(joined).toBe(true);
  expect(t.service.readPage).toHaveBeenCalledTimes(2);
  expect(t.service.extract).toHaveBeenCalledTimes(1);
}, 1000);

it('retains extraction progress when a speculative provider read fails', async () => {
  const t = setup();
  Object.assign(t.config, { purpose: 'people', companyName: 'Example Instruments', companyDomain: 'instruments.example.com' });
  t.service.pageLookahead = true;
  t.service.readPage = vi.fn(async url => {
    if (url.endsWith('/leadership')) throw new Error('Provider unavailable');
    return { status: 'completed', page: { url, markdown: '# Our team\n[Leadership](/leadership)' } };
  });
  t.service.extract = vi.fn(async () => []);
  await runResearch(t.step, t.service);
  expect(t.service.readPage).toHaveBeenCalledTimes(2);
  expect(t.progress.mock.calls.at(-1)?.[0]).toMatchObject({ status: 'partial', pages: 1 });
  expect(t.progress.mock.calls.at(-1)?.[0].runtime?.attempts).toHaveLength(2);
});

it('uses inherited objective evidence without reading or extracting it again', async () => {
  const t = setup();
  Object.assign(t.config, { mode: 'automatic', purpose: 'people', enrichmentPhase: 'initial', companyName: 'Example Instruments', companyDomain: 'instruments.example.com', inheritedFindings: [{ kind: 'person', name: 'Alex Example', value: 'Director', email: 'alex@instruments.example.com', quote: 'Alex Example Director alex@instruments.example.com', website: t.config.seeds[0] }] });
  t.service.readPage = vi.fn();
  await runResearch(t.step, t.service);
  expect(t.service.readPage).not.toHaveBeenCalled();
  expect(t.service.extract).not.toHaveBeenCalled();
  expect(t.progress.mock.calls.at(-1)?.[0]).toMatchObject({ status: 'complete', enrichmentPendingFields: [] });
});

it('defers deep missing-field searches after repeated successful empty results while leaving evidence pending', async () => {
  const t = setup();
  Object.assign(t.config, { mode: 'automatic', purpose: 'firmographics', enrichmentPhase: 'deep', diminishingReturnsSearches: 2, targetedFollowup: true, companyName: 'Example Instruments', companyDomain: 'instruments.example.com' });
  t.config.budget = { maxPages: 5, maxDomains: 1, maxMinutes: 10, maxModelCalls: 0 };
  t.service.readPage = vi.fn(async url => ({ status: 'completed', page: { url, markdown: '# Example Instruments\nWe employ 50 employees.' } }));
  t.service.targetedSearch = vi.fn().mockResolvedValueOnce({ seeds: [], failed: true }).mockResolvedValue({ seeds: [] });
  await runResearch(t.step, t.service);
  expect(t.service.targetedSearch).toHaveBeenCalledTimes(3);
  expect(t.progress.mock.calls.at(-1)?.[0]).toMatchObject({ status: 'partial', enrichmentPendingFields: ['revenue'] });
  expect(t.progress.mock.calls.at(-1)?.[0].message).toContain('2 successful searches returned no new sources');
});

it.each([false, true])('retains a read page for deferred extraction with coalescing=%s and does not consume a model call', async enabled => {
  const t = setup();
  t.config.performanceFlags = { progressCoalescing: enabled };
  t.config.budget.maxPages = 1;
  t.service.readPage = vi.fn(async url => ({ status: 'completed', page: { url, markdown: 'Example Instruments makes sensors.' } }));
  t.service.extract = vi.fn(async () => { throw new BrowserAdmissionDeferred('Worker request budget reached'); });
  await runResearch(t.step, t.service);
  const final = t.progress.mock.calls.at(-1)?.[0];
  expect(final).toMatchObject({ status: 'partial', pages: 1, modelCalls: 0 });
  expect(final?.runtime?.pendingPage?.page.markdown).toBe('Example Instruments makes sensors.');
  expect(final?.runtime?.attempts.at(-1)?.extraction?.status).toBe('deferred');
  expect(final?.runtime?.remaining).toContain(t.config.seeds[0]);
  expect(final?.runtime?.visited).not.toContain(t.config.seeds[0]);
});

it('overlaps sitemap discovery with extraction and merges links before serial progress', async () => {
  const t = setup();
  Object.assign(t.config, { purpose: 'people', companyName: 'Example Instruments', companyDomain: 'instruments.example.com' });
  t.service.pageLookahead = true;
  let releaseExtraction!: () => void;
  const extractionStarted = new Promise<void>(resolve => { releaseExtraction = resolve; });
  let releaseSitemap!: () => void;
  const sitemapStarted = new Promise<void>(resolve => { releaseSitemap = resolve; });
  let activeHostReads = 0;
  let maximumHostReads = 0;
  const beginRead = () => { maximumHostReads = Math.max(maximumHostReads, ++activeHostReads); };
  const permits: string[] = [];
  t.step.do = vi.fn(async (name, run) => run({ reservation: name }));
  t.service.readPage = vi.fn(async (url, reservation) => {
    beginRead();
    permits.push(reservation!);
    activeHostReads--;
    return { status: 'completed', page: { url, markdown: url.endsWith('/leadership') ? '# Our team\n#### Alex Example\n##### Managing Director' : '# Our company\n[Leadership](/leadership)' } };
  });
  t.service.readSiteFile = vi.fn(async (url, reservation) => {
    beginRead();
    permits.push(reservation!);
    releaseSitemap();
    await extractionStarted;
    activeHostReads--;
    return { status: 'completed', page: { url, markdown: url.endsWith('/robots.txt') ? 'Sitemap: https://instruments.example.com/sitemap.xml' : '<urlset><url><loc>https://instruments.example.com/contact</loc></url></urlset>' } };
  });
  t.service.extract = vi.fn(async () => {
    releaseExtraction();
    await sitemapStarted;
    return [];
  });
  await runResearch(t.step, t.service);
  expect(maximumHostReads).toBe(1);
  expect(new Set(permits).size).toBe(permits.length);
  expect(t.service.readPage).toHaveBeenCalledTimes(2);
  const checkpoint = t.progress.mock.calls.find(([event]) => event.page?.url === t.config.seeds[0])?.[0];
  expect(checkpoint?.runtime?.remaining).toEqual(expect.arrayContaining(['https://instruments.example.com/leadership', 'https://instruments.example.com/contact']));
  expect(checkpoint?.runtime?.bufferedPage?.url).toBe('https://instruments.example.com/leadership');
}, 1000);

it('joins sitemap work and retains its links when an extraction checkpoint is deferred', async () => {
  const t = setup();
  Object.assign(t.config, { purpose: 'people', companyName: 'Example Instruments', companyDomain: 'instruments.example.com' });
  t.config.budget.maxPages = 1;
  let extractionFailed!: () => void;
  const extractionAttempted = new Promise<void>(resolve => { extractionFailed = resolve; });
  let sitemapFinished = false;
  t.service.readPage = vi.fn(async url => ({ status: 'completed', page: { url, markdown: '# Our company\nWe make precision instruments for Australian industry.' } }));
  t.service.readSiteFile = vi.fn(async url => {
    await extractionAttempted;
    if (url.endsWith('/sitemap.xml')) sitemapFinished = true;
    return { status: 'completed', page: { url, markdown: url.endsWith('/robots.txt') ? 'Sitemap: https://instruments.example.com/sitemap.xml' : '<urlset><url><loc>https://instruments.example.com/contact</loc></url></urlset>' } };
  });
  t.step.do = vi.fn(async (name, run) => {
    if (name === 'extract-1') { extractionFailed(); throw new BrowserAdmissionDeferred('Worker request budget reached'); }
    return run();
  });
  await runResearch(t.step, t.service);
  expect(sitemapFinished).toBe(true);
  expect(t.progress.mock.calls.at(-1)?.[0].modelCalls).toBe(0);
  expect(t.progress.mock.calls.at(-1)?.[0].runtime?.remaining).toEqual(expect.arrayContaining([t.config.seeds[0], 'https://instruments.example.com/contact']));
  expect(t.progress.mock.calls.at(-1)?.[0].runtime?.pendingPage?.url).toBe(t.config.seeds[0]);
}, 1000);

it('coalesces the first status-only browser wait while preserving page, crawl-id and terminal checkpoints', async () => {
  const t = setup();
  t.config.performanceFlags = { progressCoalescing: true };
  await runResearch(t.step, t.service);
  expect(t.progress.mock.calls.some(([e]) => e.message.startsWith('Waiting for browser slot'))).toBe(false);
  expect(t.progress.mock.calls.some(([e]) => e.crawlId === '00000000-0000-4000-8000-000000000010')).toBe(true);
  expect(t.progress.mock.calls.some(([e]) => e.page?.findings.length)).toBe(true);
  expect(t.progress.mock.calls.at(-1)?.[0].status).toBe('complete');
  expect(t.progress.mock.calls.map(([e]) => e.revision)).toEqual(t.progress.mock.calls.map((_, n) => n + 1));
});

it.each([{ gap: 11000, publish: false }, { gap: 61000, publish: true }])('persists minute heartbeats with gap=$gap without changing controls or budgets', async ({ gap, publish }) => {
  const controls: string[][] = [];
  for (const enabled of [true, false]) {
    const t = setup();
    t.config.performanceFlags = { progressCoalescing: enabled };
    const originalBudget = structuredClone(t.config.budget);
    t.config.seeds.push('https://instruments.example.com/products');
    t.service.readPage = vi.fn(async url => ({ status: 'completed', page: { url, markdown: 'Example Instruments makes sensors.' } }));
    t.progress.mockImplementation(async event => { if (event.page) t.setNow(15000); });
    const control = t.service.control;
    t.service.control = async () => {
      const result = await control();
      if (t.progress.mock.calls.some(([e]) => e.page)) t.setNow(15000 + gap);
      return result;
    };
    await runResearch(t.step, t.service);
    expect(t.progress.mock.calls.some(([e]) => e.message.includes('page attempt 2'))).toBe(publish);
    expect(t.progress.mock.calls.filter(([e]) => e.page)).toHaveLength(2);
    expect(t.progress.mock.calls.at(-1)?.[0]).toMatchObject({ status: 'complete', pages: 2, modelCalls: 2 });
    expect(t.config.budget).toEqual(originalBudget);
    controls.push(vi.mocked(t.step.do).mock.calls.map(([name]) => name).filter(name => name.startsWith('control-')));
  }
  expect(controls[0]).toEqual(controls[1]);
});

it('runs the explicit Fire Central ABN search and verifies the registry without needing company-fit evidence', async () => {
  const t = setup();
  Object.assign(t.config, { mode: 'automatic', purpose: 'firmographics', researchTask: 'field', researchField: 'abn', targetedFollowup: true, companyName: 'Fire Central Pty Ltd', companyDomain: 'firecentral.com.au', companyLocation: 'Carlton VIC', seeds: [] });
  t.config.budget = { maxPages: 3, maxDomains: 3, maxMinutes: 10, maxModelCalls: 0 };
  const registry = 'https://abr.business.gov.au/ABN/View?abn=56663118241';
  t.service.discover = vi.fn(async () => ({ seeds: [] }));
  t.service.targetedSearch = vi.fn(async () => ({ seeds: [registry], exhausted: true }));
  t.service.readPage = vi.fn(async url => ({ status: 'completed', page: { url, markdown: '# Current details for ABN 56 663 118 241\nEntity name: FIRE CENTRAL PTY LTD\nMain business location: VIC 3053' } }));
  await runResearch(t.step, t.service);
  expect(t.service.targetedSearch).toHaveBeenCalledWith('abn', 1);
  expect(t.progress.mock.calls.flatMap(([event]) => event.page?.findings || [])).toContainEqual(expect.objectContaining({ name: 'ABN', value: '56663118241' }));
  expect(t.progress.mock.calls.at(-1)?.[0]).toMatchObject({ status: 'complete', pages: 1, modelCalls: 0 });
});
it('fans out every sitemap page instead of serially consuming them in the website job', async () => {
  const t = setup();
  Object.assign(t.config, { researchTask: 'website', discoveryCandidate: true, companyName: 'Example Instruments', companyDomain: 'instruments.example.com' });
  t.config.budget = { maxPages: 1, maxDomains: 1, maxMinutes: 10, maxModelCalls: 0 };
  t.service.readPage = vi.fn(async url => ({ status: 'completed', page: { url, markdown: '# Example Instruments\nWe manufacture precision sensors.' } }));
  t.service.readSiteFile = vi.fn(async url => ({ status: 'completed', page: { url, markdown: url.endsWith('/robots.txt') ? 'Sitemap: https://instruments.example.com/sitemap.xml' : '<urlset><url><loc>https://instruments.example.com/team</loc></url><url><loc>https://instruments.example.com/contact</loc></url><url><loc>https://instruments.example.com/any-unranked-page</loc></url><url><loc>https://other.example/unrelated</loc></url></urlset>' } }));
  t.service.fanoutPages = vi.fn(async () => {});
  await runResearch(t.step, t.service);
  expect(t.service.readPage).toHaveBeenCalledTimes(1);
  expect(t.service.fanoutPages).toHaveBeenCalledWith(expect.arrayContaining(['https://instruments.example.com/team', 'https://instruments.example.com/contact', 'https://instruments.example.com/any-unranked-page']));
  expect(vi.mocked(t.service.fanoutPages).mock.calls[0][0]).not.toContain('https://other.example/unrelated');
  expect(t.progress.mock.calls.at(-1)?.[0].runtime?.remaining).toEqual([]);
});
it('finishes the independent headcount objective without waiting for revenue', async () => {
  const t = setup();
  Object.assign(t.config, { mode: 'automatic', purpose: 'firmographics', researchTask: 'field', researchField: 'size', targetedFollowup: true, companyName: 'Example Instruments', companyDomain: 'instruments.example.com' });
  t.config.budget.maxModelCalls = 0;
  t.service.readPage = vi.fn(async url => ({ status: 'completed', page: { url, markdown: '# Example Instruments\nWe employ 50 employees.' } }));
  t.service.targetedSearch = vi.fn();
  await runResearch(t.step, t.service);
  expect(t.progress.mock.calls.at(-1)?.[0].status).toBe('complete');
  expect(t.service.targetedSearch).not.toHaveBeenCalled();
});
it('reads a sitemap child once and never recursively scans sitemaps or follows its page links', async () => {
  const t = setup();
  Object.assign(t.config, { researchTask: 'page', companyName: 'Example Instruments', companyDomain: 'instruments.example.com' });
  t.config.budget = { maxPages: 1, maxDomains: 1, maxMinutes: 10, maxModelCalls: 0 };
  t.service.readPage = vi.fn(async url => ({ status: 'completed', page: { url, markdown: '# Example Instruments\nWe employ 50 employees.\n[More](https://instruments.example.com/more)' } }));
  t.service.readSiteFile = vi.fn(); t.service.fanoutPages = vi.fn();
  await runResearch(t.step, t.service);
  expect(t.service.readPage).toHaveBeenCalledTimes(1);
  expect(t.service.readSiteFile).not.toHaveBeenCalled();
  expect(t.service.fanoutPages).not.toHaveBeenCalled();
  expect(t.progress.mock.calls.flatMap(([event]) => event.page?.findings || [])).toContainEqual(expect.objectContaining({ kind: 'headcount', value: '50 employees' }));
});
it('completes a field from validated evidence found concurrently by a sibling job', async () => {
  const t = setup();
  Object.assign(t.config, { mode: 'automatic', purpose: 'firmographics', researchTask: 'field', researchField: 'size', targetedFollowup: true, companyName: 'Example Instruments', companyDomain: 'instruments.example.com', seeds: [] });
  t.service.discover = vi.fn(async () => ({ seeds: [] }));
  t.config.budget.maxModelCalls = 0;
  t.service.targetedSearch = vi.fn(async () => ({ seeds: [], exhausted: true, findings: [{ kind: 'headcount' as const, name: 'Headcount', value: '50 employees', quote: 'We employ 50 employees', website: 'https://instruments.example.com/' }] }));
  await runResearch(t.step, t.service);
  expect(t.progress.mock.calls.at(-1)?.[0]).toMatchObject({ status: 'complete', pages: 0 });
  expect(t.service.submit).not.toHaveBeenCalled();
});

it('coalesces status saves during slow targeted searches while checking controls before each search', async () => {
  const t = setup();
  Object.assign(t.config, { seeds: [], purpose: 'firmographics', targetedFollowup: true, companyName: 'Example Instruments', companyDomain: 'instruments.example.com', performanceFlags: { progressCoalescing: true } });
  t.config.budget.maxModelCalls = 0;
  let searches = 0;
  t.service.targetedSearch = vi.fn(async () => {
    t.setNow(++searches * 11000);
    return { seeds: [], exhausted: false };
  });
  await runResearch(t.step, t.service);
  expect(searches).toBe(8);
  expect(t.progress.mock.calls.filter(([e]) => e.status === 'extracting')).toHaveLength(1);
  const controls = vi.mocked(t.step.do).mock.calls.map(([name]) => name);
  for (let round = 1; round <= 8; round++) {
    expect(controls).toContain(`control-targeted-followup-${round}`);
    expect(controls).toContain(`control-targeted-search-${round}`);
  }
  expect(t.progress.mock.calls.at(-1)?.[0]).toMatchObject({ status: 'partial', pages: 0, modelCalls: 0, followupSearchCounts: { size: 5, revenue: 3 } });
});

it('honours cancellation between short status-save intervals without performing another targeted search', async () => {
  const t = setup();
  Object.assign(t.config, { seeds: [], purpose: 'firmographics', targetedFollowup: true, companyName: 'Example Instruments', companyDomain: 'instruments.example.com', performanceFlags: { progressCoalescing: true } });
  t.config.budget.maxModelCalls = 0;
  let searches = 0;
  t.service.targetedSearch = vi.fn(async () => {
    t.setNow(++searches * 11000);
    if (searches === 2) t.setStatus('cancelled');
    return { seeds: [], exhausted: false };
  });
  await runResearch(t.step, t.service);
  expect(searches).toBe(2);
  expect(vi.mocked(t.step.do).mock.calls.map(([name]) => name)).toContain('control-targeted-followup-3');
  expect(t.progress.mock.calls.filter(([e]) => e.status === 'extracting')).toHaveLength(0);
  expect(t.service.readPage).toBeUndefined();
  expect(t.service.submit).not.toHaveBeenCalled();
});

function targetedCapacityFixture() {
  const t = setup();
  Object.assign(t.config, { seeds: [], mode: 'automatic', purpose: 'firmographics', researchTask: 'field', researchField: 'size', targetedFollowup: true, companyName: 'Example Instruments', companyDomain: 'instruments.example.com', enrichmentPhase: 'deep', diminishingReturnsSearches: 2 });
  t.config.budget = { maxPages: 3, maxDomains: 1, maxMinutes: 10, maxModelCalls: 0 };
  return t;
}

it('retries targeted capacity deferrals without consuming semantic search or diminishing-return budgets', async () => {
  const t = targetedCapacityFixture();
  t.config.targetedSearchDeferred = true;
  t.service.targetedSearch = vi.fn().mockResolvedValueOnce({ seeds: [], deferred: true, retryable: true, retryAfterMs: 5000 }).mockResolvedValueOnce({ seeds: [], deferred: true, retryable: true, retryAfterMs: 5000 }).mockResolvedValue({ seeds: [], findings: [{ kind: 'headcount', name: 'Headcount', value: '50 employees', quote: 'We employ 50 employees', website: 'https://instruments.example.com/' }], exhausted: true });
  await runResearch(t.step, t.service);
  expect(vi.mocked(t.service.targetedSearch).mock.calls.map(([field, round]) => [field, round])).toEqual([['size', 1], ['size', 1], ['size', 1]]);
  expect(t.step.sleep).toHaveBeenCalledTimes(2);
  expect(t.progress.mock.calls[0][0].targetedSearchDeferred).toBe(true);
  expect(t.progress.mock.calls.at(-1)?.[0]).toMatchObject({ status: 'complete', targetedSearchDeferred: false, pages: 0, modelCalls: 0, followupSearchCounts: { size: 1 } });
  const names = vi.mocked(t.step.do).mock.calls.map(([name]) => name).filter(name => name.startsWith('targeted-search-'));
  expect(new Set(names).size).toBe(names.length);
});

it('bounds persistent targeted capacity waits and checkpoints pending research without exhausted fields', async () => {
  const t = targetedCapacityFixture();
  t.service.targetedSearch = vi.fn(async () => ({ seeds: [], deferred: true, retryable: true, retryAfterMs: 999999 }));
  await runResearch(t.step, t.service);
  expect(t.service.targetedSearch).toHaveBeenCalledTimes(4);
  expect(t.step.sleep).toHaveBeenCalledTimes(3);
  expect(vi.mocked(t.step.sleep).mock.calls.every(([, milliseconds]) => milliseconds > 0 && milliseconds <= 15000)).toBe(true);
  expect(t.progress.mock.calls.at(-1)?.[0]).toMatchObject({ status: 'partial', targetedSearchDeferred: true, pages: 0, modelCalls: 0, followupSearchCounts: {}, followupEmptySearchCounts: {}, followupExhaustedFields: [], enrichmentPendingFields: ['size'] });
  expect(t.progress.mock.calls.at(-1)?.[0].message).toContain('targeted search capacity');
});

it('checks cancellation after a targeted capacity wait before another provider call', async () => {
  const t = targetedCapacityFixture();
  t.service.targetedSearch = vi.fn(async () => ({ seeds: [], deferred: true, retryable: true, retryAfterMs: 3000 }));
  t.step.sleep = vi.fn(async () => { t.setStatus('cancelled'); });
  await runResearch(t.step, t.service);
  expect(t.service.targetedSearch).toHaveBeenCalledTimes(1);
  expect(t.step.sleep).toHaveBeenCalledTimes(1);
  expect(t.progress.mock.calls.some(([event]) => event.status === 'complete')).toBe(false);
});

it('limits a targeted capacity wait to the existing deadline without resetting budgets', async () => {
  const t = targetedCapacityFixture();
  t.setNow(599000);
  t.service.targetedSearch = vi.fn(async () => ({ seeds: [], deferred: true, retryable: true, retryAfterMs: 15000 }));
  t.step.sleep = vi.fn(async (_name, milliseconds) => { t.setNow(599000 + milliseconds); });
  await runResearch(t.step, t.service);
  expect(t.service.targetedSearch).toHaveBeenCalledTimes(1);
  expect(t.step.sleep).toHaveBeenCalledWith(expect.any(String), 1000);
  expect(t.progress.mock.calls.at(-1)?.[0]).toMatchObject({ status: 'partial', modelCalls: 0, followupSearchCounts: {}, followupExhaustedFields: [] });
  expect(t.config.budget).toMatchObject({ maxPages: 3, maxModelCalls: 0, maxMinutes: 10 });
});

it('recovers targeted step admission deferral without treating it as an exhausted search', async () => {
  const t = targetedCapacityFixture();
  t.service.targetedSearch = vi.fn(async () => ({ seeds: [], exhausted: true }));
  t.step.do = vi.fn(async (name, run) => {
    if (name === 'targeted-search-1') throw new BrowserAdmissionDeferred('Reader capacity temporarily busy');
    return run();
  });
  await runResearch(t.step, t.service);
  expect(t.step.sleep).toHaveBeenCalledTimes(1);
  expect(t.service.targetedSearch).toHaveBeenCalledTimes(1);
  expect(t.progress.mock.calls.at(-1)?.[0].followupSearchCounts).toEqual({ size: 1 });
});

it('yields immediately when the targeted checkpoint request guard is reached', async () => {
  const t = targetedCapacityFixture();
  t.step.do = vi.fn(async (name, run) => {
    if (name === 'targeted-search-1') throw new BrowserAdmissionDeferred('Worker request budget reached; continue with a fresh request budget');
    return run();
  });
  t.service.targetedSearch = vi.fn();
  await runResearch(t.step, t.service);
  expect(t.service.targetedSearch).not.toHaveBeenCalled();
  expect(t.step.sleep).not.toHaveBeenCalled();
  expect(t.progress.mock.calls.at(-1)?.[0]).toMatchObject({ status: 'partial', followupSearchCounts: {}, followupExhaustedFields: [], modelCalls: 0, pages: 0 });
  expect(t.progress.mock.calls.at(-1)?.[0].message).toContain('Worker request budget reached');
});

it('persists a paid follow-up planner attempt and does not bill it again after capacity continuation', async () => {
  const first = targetedCapacityFixture();
  first.config.budget.maxModelCalls = 2;
  first.service.planFollowup = vi.fn(async () => ({ choice: 'search_size' }));
  first.service.targetedSearch = vi.fn(async () => ({ seeds: [], deferred: true, retryable: true, retryAfterMs: 1000 }));
  await runResearch(first.step, first.service);
  const checkpoint = first.progress.mock.calls.at(-1)?.[0];
  expect(first.service.planFollowup).toHaveBeenCalledTimes(1);
  expect(checkpoint).toMatchObject({ modelCalls: 1, targetedSearchDeferred: true, followupPlannerUsed: true });
  const resumed = targetedCapacityFixture();
  Object.assign(resumed.config, { ...first.config, runtime: checkpoint?.runtime, targetedSearchDeferred: true, followupPlannerUsed: checkpoint?.followupPlannerUsed, budget: { ...first.config.budget, maxModelCalls: first.config.budget.maxModelCalls - checkpoint!.modelCalls } });
  resumed.service.planFollowup = vi.fn(async () => ({ choice: 'search_size' }));
  resumed.service.targetedSearch = vi.fn(async () => ({ seeds: [], exhausted: true, findings: [{ kind: 'headcount' as const, name: 'Headcount', value: '50 employees', quote: 'We employ 50 employees', website: 'https://instruments.example.com/' }] }));
  await runResearch(resumed.step, resumed.service);
  expect(resumed.service.planFollowup).not.toHaveBeenCalled();
  expect(resumed.progress.mock.calls.at(-1)?.[0]).toMatchObject({ status: 'complete', pages: 0, modelCalls: 0, targetedSearchDeferred: false, followupPlannerUsed: true });
  expect(resumed.config.budget).toMatchObject({ maxPages: 3, maxModelCalls: 1 });
});
