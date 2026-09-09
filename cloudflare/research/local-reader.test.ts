import { expect, it, vi } from "vitest";
import { localRead, localReaderEndpoint } from "./local-reader";
const env = { LOCAL_DEVELOPMENT: "true", LOCAL_CRAWL4AI_URL: "http://127.0.0.1:18083" };
it("reads through loopback Crawl4AI with the common page contract and no cloud credentials", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ url: "https://example.com/", markdown: "Example business" }));
  expect(await localRead(env, "https://example.com/", { jobId: "test-job" }, fetcher)).toEqual({ status: "completed", page: { url: "https://example.com/", markdown: "Example business" } });
  expect(fetcher.mock.calls[0][0]).toBe("http://127.0.0.1:18083/crawl");
  expect(fetcher.mock.calls[0][1].headers).not.toHaveProperty("Authorization");
});
it("requires explicit local mode and only the fixed loopback endpoint", () => {
  expect(() => localReaderEndpoint({})).toThrow(/local development/);
  for (const endpoint of ["https://remote.example.com", "http://127.0.0.1:9999", "http://user:secret@127.0.0.1:18083", "http://127.0.0.1:18083/other"]) expect(() => localReaderEndpoint({ ...env, LOCAL_CRAWL4AI_URL: endpoint })).toThrow();
});
it("retains search query parameters but rejects private targets and never retries remotely", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ error: "Reader offline" }, { status: 502 }));
  await expect(localRead(env, "https://html.duckduckgo.com/html/?q=example", {}, fetcher)).rejects.toThrow(/502/);
  expect(JSON.parse(fetcher.mock.calls[0][1].body).url).toContain("?q=example");
  expect(fetcher).toHaveBeenCalledTimes(1);
  await expect(localRead(env, "http://localhost/private", {}, fetcher)).rejects.toThrow(/Unsupported/);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
