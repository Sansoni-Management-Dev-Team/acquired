import { describe, expect, it } from "vitest";
import { sitemapDocument, sitemapMarkdown, sitemapUrls } from "./sitemap";

describe("sitemap discovery", () => {
  it("extracts same-site robots and XML locations while excluding foreign hosts", () => {
    const content = `Sitemap: https://www.example.com/sitemap_index.xml\n<loc>https://example.com/about-us/</loc><loc>https://other.example.net/team</loc>`;
    expect(sitemapUrls(content, "https://example.com/")).toEqual([
      "https://example.com/about-us/",
      "https://www.example.com/sitemap_index.xml",
    ]);
  });

  it("decodes XML entities, identifies nested sitemap documents and builds page links", () => {
    const urls = sitemapUrls("<loc>https://example.com/team/?a=1&amp;b=2</loc><loc>https://example.com/page-sitemap.xml</loc>", "https://example.com/");
    expect(urls).toEqual(["https://example.com/team/", "https://example.com/page-sitemap.xml"]);
    expect(sitemapDocument(urls[1])).toBe(true);
    expect(sitemapMarkdown(urls)).toBe("[/team/](https://example.com/team/)");
  });
});
