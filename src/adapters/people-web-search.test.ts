import { afterEach, expect, it, vi } from "vitest";
import { peopleWebSeeds } from "./people-web-search";
afterEach(() => vi.unstubAllEnvs());
it("makes one bounded search and uses URLs rather than trusting snippets", async () => {
  vi.stubEnv("TAVILY_API_KEY", "test-key");
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ results: [{ url: "https://instruments.example.com/team", content: "Untrusted snippet" }, { url: "http://localhost/" }, { url: "https://spokeo.com/example" }] }));
  expect(await peopleWebSeeds("Example Instruments", "instruments.example.com", fetcher)).toEqual(["https://instruments.example.com/team"]);
  expect(fetcher).toHaveBeenCalledOnce();
  const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
  expect(body).toMatchObject({ max_results: 6, search_depth: "basic", include_raw_content: false, include_answer: false });
});
it("reports unavailable search instead of silently claiming coverage", async () => {
  vi.stubEnv("TAVILY_API_KEY", "");
  await expect(peopleWebSeeds("Example", "example.com")).rejects.toThrow("not configured");
});
