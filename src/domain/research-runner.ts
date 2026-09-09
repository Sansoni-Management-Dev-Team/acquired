import { businessPrompt, validateBusinessFindings } from "./business-research";
import { companyHeadcountPrompt, observedCompanyFacts, headcountModelFindings, companyFactLinks, orderCompanyFactQueue } from "./company-facts";
import { peoplePrompt, validatePeopleFindings, peopleFollowUpLinks, orderPeopleQueue } from "./people-research";
import {
  extractionPrompt,
  catalogueProductFindings,
  statedSupplyFindings,
  followUpLinks,
  publicResearchUrl,
  terminalResearchStates,
  validateFindings,
  orderResearchQueue,
  researchDomain,
  uniqueResearchUrls,
  type ResearchConfig,
  type ResearchPage,
  type ResearchRuntime,
} from "./research";
export interface ResearchSteps {
  do<T>(name: string, run: () => Promise<T>, retry?: boolean): Promise<T>;
  sleep(name: string, milliseconds: number): Promise<void>;
}
export type ResearchControl = {
  status: string;
  config: ResearchConfig;
  seeds: string[];
  deadline: number;
  stopReason?: string;
};
export interface ResearchServices {
  control(): Promise<ResearchControl>;
  discover(): Promise<{ seeds: string[]; warning?: string; peopleLeadCount?: number }>;
  progress(event: {
    revision: number;
    status: string;
    pages: number;
    modelCalls: number;
    message: string;
    crawlId?: string | null;
    page?: ResearchPage;
    runtime?: ResearchRuntime;
  }): Promise<void>;
  submit(url: string): Promise<string>;
  poll(
    id: string,
  ): Promise<{
    status: string;
    page?: { url: string; markdown: string; title?: string };
    warning?: string;
  }>;
  cancel(id: string): Promise<void>;
  extract(messages: ReturnType<typeof extractionPrompt>): Promise<unknown>;
  extractHeadcount?(messages: ReturnType<typeof companyHeadcountPrompt>): Promise<unknown>;
  readPeoplePage?(url: string): Promise<{ status: string; page?: { url: string; markdown: string; title?: string }; warning?: string }>;
  peopleFollowup?(): Promise<{ seeds: string[]; legalEntity?: string; warning?: string }>;
  now(): number;
}
export async function runResearch(
  step: ResearchSteps,
  service: ResearchServices,
) {
  let revision = 0,
    pages = 0,
    modelCalls = 0,
    activeCrawl: string | null = null;
  const warnings: string[] = [];
  let runtime: ResearchRuntime = { remaining: [], visited: [], attempts: [] };
  const publish = async (
    status: string,
    message: string,
    page?: ResearchPage,
  ) => {
    const event = {
      revision: ++revision,
      status,
      pages,
      modelCalls,
      message: message.slice(0, 1000),
      crawlId: activeCrawl,
      runtime: structuredClone(runtime),
      ...(page ? { page } : {}),
    };
    await step.do(`progress-${revision}`, () => service.progress(event));
  };
  const check = async (label: string) =>
    step.do(`control-${label}`, async () => {
      const data = await service.control();
      return { ...data, expired: service.now() >= data.deadline };
    });
  try {
    const initial = await check("start");
    if (terminalResearchStates.includes(initial.status)) return;
    runtime = {
      remaining: [...(initial.config.runtime?.remaining || initial.seeds)],
      visited: [...(initial.config.runtime?.visited || [])],
      attempts: [],
    };
    if (initial.expired) {
      await publish("partial", "Job time budget elapsed before starting");
      return;
    }
    await publish(
      "discovering",
      initial.config.discover
        ? "Finding starting websites"
        : "Resuming approved websites",
    );
    const discovered = await step.do("discover", () => service.discover());
    if (discovered.warning) warnings.push(discovered.warning);
    runtime.remaining = orderResearchQueue(
      [...runtime.remaining, ...discovered.seeds],
      runtime.visited,
    ).slice(0, 200);
    const domains = new Set<string>(initial.config.autoDomains || []),
      budget = initial.config.budget;
    let peopleFollowupAttempted = Boolean(initial.config.peopleFollowupStarted);
    while (
      (runtime.remaining.length || (!peopleFollowupAttempted && initial.config.purpose === "people" && initial.config.maxPeopleSearches === 2 && Boolean(service.peopleFollowup))) &&
      runtime.attempts.length < budget.maxPages
    ) {
      if (!peopleFollowupAttempted && runtime.attempts.length && initial.config.purpose === "people" && initial.config.maxPeopleSearches === 2 && service.peopleFollowup && ((discovered.peopleLeadCount || initial.config.peopleSearchLeads?.length || 0) > 0 || runtime.attempts.some(a => a.reason.includes("legal operator")) || runtime.attempts.length >= Math.min(3, budget.maxPages - 1) || !runtime.remaining.length)) {
        await step.sleep("people-search-spacing", 21000);
        const current = await check(`people-followup-${runtime.attempts.length}`);
        if (terminalResearchStates.includes(current.status)) return;
        if (current.expired) { warnings.push(current.stopReason || "Time limit reached"); break; }
        peopleFollowupAttempted = true;
        const followup = await step.do("people-followup", () => service.peopleFollowup!(), false);
        if (followup.warning) warnings.push(followup.warning);
        runtime.remaining = uniqueResearchUrls([...followup.seeds, ...runtime.remaining]).slice(0, 200);
      }
      runtime.remaining = orderResearchQueue(runtime.remaining,runtime.visited,initial.config.strategy,runtime.attempts.map(a=>a.url));
      if (initial.config.purpose === "people") runtime.remaining = orderPeopleQueue(runtime.remaining, runtime.visited, initial.config.companyDomain!);
      if (initial.config.purpose === "firmographics") runtime.remaining = orderCompanyFactQueue(runtime.remaining, initial.config);
      const index = runtime.remaining.findIndex(
        (u) =>
          domains.has(researchDomain(u)) || domains.size < budget.maxDomains,
      );
      if (index < 0) {
        warnings.push("Domain limit reached");
        break;
      }
      const control = await check(`page-${runtime.attempts.length}`);
      if (terminalResearchStates.includes(control.status)) return;
      if (control.expired) {
        warnings.push(control.stopReason || "Time limit reached");
        break;
      }
      const url = runtime.remaining.splice(index, 1)[0],
        attempt = runtime.attempts.length + 1;
      domains.add(researchDomain(url));
      runtime.visited = uniqueResearchUrls([...runtime.visited, url]).slice(
        -1000,
      );
      const entry: ResearchRuntime["attempts"][number] = {
        url,
        status: "pending",
        reason: "Submission pending",
      };
      runtime.attempts.push(entry);
      await publish(
        "crawling",
        `Reading website ${domains.size}, page attempt ${attempt} of ${budget.maxPages}`,
      );
      try {
        let result: Awaited<ReturnType<ResearchServices["poll"]>> | undefined;
        if (initial.config.purpose === "people" && service.readPeoplePage) {
          await step.sleep(`people-reader-spacing-${attempt}`, 21000);
          result = await step.do(`read-people-${attempt}`, async () => {
            const current = await service.control();
            if (terminalResearchStates.includes(current.status) || service.now() >= current.deadline) throw new Error("Stopped before reading");
            return service.readPeoplePage!(url);
          }, false);
        } else {
          activeCrawl = await step.do(
            `submit-${attempt}`,
            async () => {
              const current = await service.control();
              if (
                terminalResearchStates.includes(current.status) ||
                service.now() >= current.deadline
              )
                throw new Error("Stopped before submission");
              return service.submit(url);
            },
            false,
          );
          entry.crawlId = activeCrawl;
          entry.reason = "Waiting for crawler";
          await publish("crawling", `Waiting for ${new URL(url).hostname}`);
          for (let poll = 0; poll < 30; poll++) {
            await step.sleep(`sleep-${attempt}-${poll}`, 11000);
            const current = await check(`poll-${attempt}-${poll}`);
            if (
              terminalResearchStates.includes(current.status) ||
              current.expired
            ) {
              try {
                await step.do(`cancel-${attempt}`, () => service.cancel(activeCrawl!), false);
              } catch { /* A completed or unavailable crawl must not prevent saving the continuation. */ }
              activeCrawl = null;
              entry.status = "failed";
              entry.reason = "Stopped while waiting for crawler";
              if (!terminalResearchStates.includes(current.status))
                await publish(
                  "partial",
                  current.stopReason || "Time limit reached; unfinished crawl cancelled",
                );
              return;
            }
            result = await step.do(`poll-${attempt}-${poll}`, () =>
              service.poll(activeCrawl!),
            );
            if (result.status !== "running") break;
          }
        }
        if (!result || result.status === "running") {
          await step.do(`cancel-timeout-${attempt}`, () =>
            service.cancel(activeCrawl!),
          );
          activeCrawl = null;
          entry.status = "failed";
          entry.reason = "Crawler polling timed out";
          warnings.push(entry.reason);
          await publish("crawling", entry.reason);
          continue;
        }
        activeCrawl = null;
        if (result.status !== "completed" || !result.page) {
          entry.status = "failed";
          entry.reason = (
            result.warning || `Crawler status: ${result.status}`
          ).slice(0, 300);
          warnings.push("Some pages could not be read; see page details");
          await publish("crawling", entry.reason);
          continue;
        }
        const sourceUrl = publicResearchUrl(result.page.url);
        if (!sourceUrl) {
          entry.status = "failed";
          entry.reason = "Unsupported redirect URL";
          await publish("crawling", entry.reason);
          continue;
        }
        pages++;
        entry.status = "read";
        entry.finalUrl = sourceUrl;
        entry.reason = "Read; no supported claims extracted yet";
        runtime.visited = uniqueResearchUrls([
          ...runtime.visited,
          sourceUrl,
        ]).slice(-1000);
        const markdown = `${result.page.title ? `# ${result.page.title}\n\n` : ""}${result.page.markdown}`.slice(0, 24000);
        runtime.remaining = orderResearchQueue(
          [
            ...runtime.remaining,
            ...(initial.config.purpose === "firmographics" ? companyFactLinks(markdown, sourceUrl, initial.config, runtime.visited) : initial.config.purpose === "people" ? peopleFollowUpLinks(markdown, sourceUrl, runtime.visited, initial.config) : followUpLinks(
              markdown,
              sourceUrl,
              initial.config.searchTerms,
              runtime.visited,
            )),
          ],
          runtime.visited,
        ).slice(0, 200);
        let findings: ResearchPage["findings"] = [];
        if (modelCalls < budget.maxModelCalls) {
          modelCalls++;
          await publish(
            "extracting",
            initial.config.purpose === "firmographics" ? "Checking sourced company headcount" : initial.config.purpose === "people" ? `Looking for named decision-makers on website ${domains.size}` : `Assessing products and business role on website ${domains.size}`,
          );
          const extracted = await step.do(
            `extract-${attempt}`,
            async () => {
              const current = await service.control();
              if (
                terminalResearchStates.includes(current.status) ||
                service.now() >= current.deadline
              )
                return { findings: [], warning: "Extraction stopped" };
              try {
                if (initial.config.purpose === "firmographics") {
                  if (!service.extractHeadcount) throw new Error("Headcount extraction unavailable");
                  const output = await service.extractHeadcount(companyHeadcountPrompt(markdown, sourceUrl, current.config));
                  return { findings: headcountModelFindings(output, markdown, sourceUrl, current.config), warning: "" };
                }
                return {
                  findings: (initial.config.purpose === "people" ? (input: unknown, markdown: string, source: string) => validatePeopleFindings(input, markdown, source, current.config) : initial.config.workflow === "business" ? (input: unknown, markdown: string, source: string) => validateBusinessFindings(input, markdown, source, current.config) : validateFindings)(
                    await service.extract(
                      initial.config.purpose === "people" ? peoplePrompt(markdown, sourceUrl, current.config) : initial.config.workflow === "business" ? businessPrompt(markdown, initial.config.searchTerms, sourceUrl, Boolean(initial.config.findPeople)) : extractionPrompt(
                        markdown,
                        initial.config.searchTerms,
                        sourceUrl,
                      ),
                    ),
                    markdown,
                    sourceUrl,
                    initial.config.searchTerms,
                  ),
                  warning: "",
                };
              } catch {
                return {
                  findings: initial.config.purpose === "firmographics" ? observedCompanyFacts(markdown, sourceUrl, current.config) : [],
                  warning: "Evidence extraction failed; page read successfully",
                };
              }
            },
            false,
          );
          findings = extracted.findings;
          if (extracted.warning) warnings.push(extracted.warning);
          entry.reason =
            extracted.warning ||
            (initial.config.purpose === "people" ? `${findings.filter(f => f.kind === "person").length} sourced people leads${findings.some(f => f.kind === "identifier") ? "; legal operator identified" : ""}; role currency and email remain unverified` : `${findings.length} supported claims; financial fit remains unknown`);
        } else { entry.reason = "Read without AI extraction (model limit)"; if (initial.config.purpose === "firmographics") findings = observedCompanyFacts(markdown, sourceUrl, initial.config); }
        const catalogue = initial.config.purpose ? [] : [...statedSupplyFindings(markdown, sourceUrl, initial.config.searchTerms), ...catalogueProductFindings(markdown, sourceUrl, initial.config.searchTerms)]
          .filter(c => !findings.some(f => f.kind === c.kind && f.value === c.value));
        findings = [...findings, ...catalogue].slice(0, initial.config.purpose === "firmographics" ? 8 : 4);
        if (catalogue.length) entry.reason = `${findings.length} supported claims including directly observed website evidence; financial fit remains unknown`;
        const observedAt = await step.do(`observed-${attempt}`, async () =>
          new Date(service.now()).toISOString(),
        );
        await publish(
          "crawling",
          `${pages} pages read across ${domains.size} websites`,
          {
            url: sourceUrl,
            markdown,
            observedAt,
            findings,
            truncated: result.page.markdown.length > 24000,
          },
        );
      } catch {
        if (activeCrawl) {
          try {
            await step.do(`cancel-error-${attempt}`, () =>
              service.cancel(activeCrawl!),
            );
          } catch {
            /* best effort cleanup */
          }
        }
        activeCrawl = null;
        entry.status = "failed";
        entry.reason =
          "Provider request failed or timed out; not automatically retried to avoid duplicate charges";
        warnings.push("Some pages could not be read; see page details");
        await publish("crawling", entry.reason);
      }
    }
    if (runtime.remaining.length)
      warnings.push(
        `${runtime.remaining.length} URLs remain; continue research with a fresh budget`,
      );
    if (!pages) warnings.push("No pages could be read");
    await publish(
      warnings.length ? "partial" : "complete",
      [
        `${pages} pages read across ${domains.size} websites.`,
        ...new Set(warnings),
      ].join(" "),
    );
  } catch {
    if (activeCrawl) {
      try {
        await step.do("cancel-failed-workflow", () =>
          service.cancel(activeCrawl!),
        );
      } catch {
        /* report failure even if provider unavailable */
      }
    }
    await publish(
      pages ? "partial" : "failed",
      "Research interrupted; saved progress retained. Continue remaining URLs with a fresh budget.",
    );
  }
}
