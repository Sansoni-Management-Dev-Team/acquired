import { describe, expect, it, vi } from "vitest";
import {
  runResearch,
  type ResearchServices,
  type ResearchSteps,
} from "./research-runner";
import type { ResearchConfig } from "./research";
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
describe("bounded research orchestration", () => {
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

it("runs the dedicated headcount extractor and saves independently validated facts within the page allowance", async () => {
  const t = setup();
  Object.assign(t.config, { purpose: "firmographics", companyName: "Example Instruments", companyDomain: "instruments.example.com" });
  t.config.budget.maxPages = 1;
  vi.mocked(t.service.poll).mockResolvedValue({ status: "completed", page: { url: t.config.seeds[0], markdown: "We employ 50 employees. [About](/about)" } });
  t.service.extractHeadcount = vi.fn().mockResolvedValue({ value: "50 employees", quote: "We employ 50 employees" });
  await runResearch(t.step, t.service);
  expect(t.service.extract).not.toHaveBeenCalled();
  expect(t.service.extractHeadcount).toHaveBeenCalledOnce();
  expect(t.progress.mock.calls.find(([e]) => e.page)?.[0].page?.findings[0]).toMatchObject({ kind: "headcount", value: "50 employees" });
  expect(t.progress.mock.calls.at(-1)?.[0]).toMatchObject({ pages: 1, modelCalls: 1 });
});
it("retains explicit company facts on AI failure and never invents a count", async () => {
  const t = setup(); Object.assign(t.config, { purpose: "firmographics", companyName: "Example Instruments", companyDomain: "instruments.example.com" });
  t.service.extractHeadcount = vi.fn().mockRejectedValue(new Error("provider failure"));
  vi.mocked(t.service.poll).mockResolvedValue({ status: "completed", page: { url: t.config.seeds[0], markdown: "We were founded in 2011. We are a family business." } });
  await runResearch(t.step, t.service);
  expect(t.progress.mock.calls.find(([e]) => e.page)?.[0].page?.findings.map(f => f.kind)).toEqual(["founded_year"]);
  expect(t.progress.mock.calls.at(-1)?.[0].status).toBe("partial");
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
