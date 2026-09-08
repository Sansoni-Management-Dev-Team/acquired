import {
  extractionPrompt,
  followUpLinks,
  publicResearchUrl,
  terminalResearchStates,
  validateFindings,
  type ResearchConfig,
  type ResearchPage,
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
};
export interface ResearchServices {
  control(): Promise<ResearchControl>;
  discover(): Promise<{ seeds: string[]; warning?: string }>;
  progress(event: {
    revision: number;
    status: string;
    pages: number;
    modelCalls: number;
    message: string;
    crawlId?: string | null;
    page?: ResearchPage;
  }): Promise<void>;
  submit(url: string): Promise<string>;
  poll(
    id: string,
  ): Promise<{
    status: string;
    page?: { url: string; markdown: string };
    warning?: string;
  }>;
  cancel(id: string): Promise<void>;
  extract(messages: ReturnType<typeof extractionPrompt>): Promise<unknown>;
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
    if (initial.expired) {
      await publish("partial", "Job time budget elapsed before starting");
      return;
    }
    await publish("discovering", "Finding starting URLs");
    const discovered = await step.do("discover", () => service.discover());
    if (discovered.warning) warnings.push(discovered.warning);
    const queue = [
      ...new Set(
        [...initial.seeds, ...discovered.seeds]
          .map(publicResearchUrl)
          .filter((u): u is string => Boolean(u)),
      ),
    ];
    const visited: string[] = [],
      domains = new Set<string>();
    const budget = initial.config.budget;
    let attempts = 0;
    while (queue.length && attempts < budget.maxPages) {
      const url = queue.shift()!;
      const domain = new URL(url).hostname.replace(/^www\./, "");
      if (visited.includes(url)) continue;
      if (!domains.has(domain) && domains.size >= budget.maxDomains) {
        warnings.push("Domain limit reached");
        continue;
      }
      const control = await check(`page-${attempts}`);
      if (terminalResearchStates.includes(control.status)) return;
      if (control.expired) {
        warnings.push("Time limit reached");
        break;
      }
      visited.push(url);
      domains.add(domain);
      attempts++;
      await publish(
        "crawling",
        `Crawling page ${attempts} of ${budget.maxPages}`,
      );
      try {
        // Submission is not automatically retried: a network timeout may hide an accepted paid job.
        activeCrawl = await step.do(
          `submit-${attempts}`,
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
        await publish("crawling", `Waiting for page ${attempts}`);
        let result: Awaited<ReturnType<ResearchServices["poll"]>> | undefined;
        for (let poll = 0; poll < 30; poll++) {
          await step.sleep(`sleep-${attempts}-${poll}`, 11000);
          const control = await check(`poll-${attempts}-${poll}`);
          if (
            terminalResearchStates.includes(control.status) ||
            control.expired
          ) {
            await step.do(`cancel-${attempts}`, () =>
              service.cancel(activeCrawl!),
            );
            activeCrawl = null;
            if (!terminalResearchStates.includes(control.status))
              await publish(
                "partial",
                "Time limit reached; unfinished crawl cancelled",
              );
            return;
          }
          result = await step.do(`poll-${attempts}-${poll}`, () =>
            service.poll(activeCrawl!),
          );
          if (result.status !== "running") break;
        }
        if (!result || result.status === "running") {
          await step.do(`cancel-timeout-${attempts}`, () =>
            service.cancel(activeCrawl!),
          );
          warnings.push("A crawl exceeded the polling limit");
          activeCrawl = null;
          continue;
        }
        activeCrawl = null;
        if (result.status !== "completed" || !result.page) {
          warnings.push(
            result.warning || "A page was unavailable or disallowed",
          );
          continue;
        }
        pages++;
        const sourceUrl = publicResearchUrl(result.page.url);
        if (!sourceUrl) {
          warnings.push("Unsupported page URL");
          continue;
        }
        const markdown = result.page.markdown.slice(0, 24000);
        let findings: ResearchPage["findings"] = [];
        if (modelCalls < budget.maxModelCalls) {
          await publish(
            "extracting",
            `Extracting sourced evidence from page ${pages}`,
          );
          modelCalls++;
          const extracted = await step.do(
            `extract-${attempts}`,
            async () => {
              const current = await service.control();
              if (
                terminalResearchStates.includes(current.status) ||
                service.now() >= current.deadline
              )
                return { findings: [], warning: "Extraction stopped" };
              try {
                return {
                  findings: validateFindings(
                    await service.extract(extractionPrompt(markdown)),
                    markdown,
                    sourceUrl,
                  ),
                  warning: "",
                };
              } catch {
                return {
                  findings: [],
                  warning:
                    "Evidence extraction failed; linked pages may still be explored",
                };
              }
            },
            false,
          );
          findings = extracted.findings;
          if (extracted.warning) warnings.push(extracted.warning);
        } else
          warnings.push(
            "Model-call limit reached; linked pages may still be explored",
          );
        const observedAt = await step.do(`observed-${attempts}`, async () =>
          new Date(service.now()).toISOString(),
        );
        await publish(
          "crawling",
          `${pages} pages read; findings require review`,
          {
            url: sourceUrl,
            markdown,
            observedAt,
            findings,
            truncated: result.page.markdown.length > 24000,
          },
        );
        // Follow linked public pages by relevant capability terms, never model-invented URLs.
        queue.unshift(
          ...followUpLinks(
            markdown,
            sourceUrl,
            initial.config.searchTerms,
            visited,
          ).filter((u) => !queue.includes(u)),
        );
      } catch {
        if (activeCrawl)
          await step.do(`cancel-error-${attempts}`, () =>
            service.cancel(activeCrawl!),
          );
        activeCrawl = null;
        warnings.push(
          "A crawl failed; submission was not repeated to avoid duplicate charges",
        );
      }
    }
    if (queue.length)
      warnings.push("Page budget reached; unvisited URLs remain");
    if (!pages) warnings.push("No pages could be read");
    await publish(
      warnings.length ? "partial" : "complete",
      [
        `${pages} pages read.`,
        ...new Set(warnings),
        "This is bounded research, not complete market coverage.",
      ].join(" "),
    );
  } catch {
    if (activeCrawl) {
      try {
        await step.do("cancel-failed-workflow", () =>
          service.cancel(activeCrawl!),
        );
      } catch {
        /* Report failure even if the provider cannot acknowledge cancellation. */
      }
    }
    await publish(
      pages ? "partial" : "failed",
      "Research interrupted; saved results retained. Start a new job to continue.",
    );
  }
}
