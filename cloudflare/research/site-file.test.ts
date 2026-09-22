import { expect, it, vi } from "vitest";
import { readSiteText } from "./site-file";
import { ResearchProviderError } from "../../src/domain/research-provider-error";

const response = (body: string, init: ResponseInit & { url?: string } = {}) => {
  const r = new Response(body, init);
  return init.url ? Object.defineProperty(r, "url", { value: init.url }) : r;
};

it("reads robots and sitemap text without a browser and counts one request", async () => {
  const fetcher = vi.fn(async () => response("Sitemap: https://example.com/sitemap.xml", { headers: { "content-type": "text/plain" }, url: "https://example.com/robots.txt" }));
  const onRequest = vi.fn();
  const result = await readSiteText("https://example.com/robots.txt", fetcher as unknown as typeof fetch, onRequest);
  expect(result).toMatchObject({ status: "completed", page: { url: "https://example.com/robots.txt", markdown: "Sitemap: https://example.com/sitemap.xml" } });
  expect(onRequest).toHaveBeenCalledOnce();
  const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(init.redirect).toBe("follow");
});

it("treats an HTML page or a 404 as a missing document so the run cache can remember it", async () => {
  const html = vi.fn(async () => response("<html>Not a sitemap</html>", { headers: { "content-type": "text/html" } }));
  await expect(readSiteText("https://example.com/sitemap.xml", html as unknown as typeof fetch)).rejects.toMatchObject({ status: 404 });
  const missing = vi.fn(async () => response("", { status: 404 }));
  const error = await readSiteText("https://example.com/sitemap.xml", missing as unknown as typeof fetch).catch(e => e);
  expect(error).toBeInstanceOf(ResearchProviderError);
  expect(error.status).toBe(404);
});

it("rejects non-public URLs and redirects to non-public destinations before reading", async () => {
  const fetcher = vi.fn(async () => response("data", { url: "http://127.0.0.1/sitemap.xml" }));
  await expect(readSiteText("http://example.com/robots.txt", fetcher as unknown as typeof fetch)).rejects.toThrow("Unsupported public URL");
  await expect(readSiteText("https://example.com/robots.txt", fetcher as unknown as typeof fetch)).rejects.toBeInstanceOf(ResearchProviderError);
});
