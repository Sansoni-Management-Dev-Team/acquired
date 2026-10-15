import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PageLoading } from "./page-loading";

const location = vi.hoisted(() => ({ pathname: "/", query: "", suspended: false }));
vi.mock("next/navigation", () => ({
  usePathname: () => location.pathname,
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => {
    if (location.suspended) throw new Promise(() => {});
    return new URLSearchParams(location.query);
  },
}));

describe("instant page loading", () => {
  it.each([
    ["/", "", "Create a mandate"],
    ["/mandates", "", "Acquisition mandates"],
    ["/mandates/new", "", "Create a mandate"],
    ["/mandates/example", "", "Brief"],
    ["/mandates/example", "tab=targets", "Companies"],
    ["/mandates/example/people", "enrichmentRuns=example", "People"],
    ["/mandates/example/outreach/sequences", "", "Sequences"],
    ["/mandates/example/targets/company", "", "Company details"],
    ["/settings", "", "Settings"],
    ["/audit", "", "Audit trail"],
    ["/outreach", "", "People"],
    ["/onboarding", "", "Create your workspace"],
    ["/sign-in", "", "Sign in to the deal desk"],
    ["/reset-password", "", "Choose a new password"],
  ])("shows the %s UI independently of page data", (pathname, query, title) => {
    Object.assign(location, { pathname, query, suspended: false });
    const html = renderToStaticMarkup(<PageLoading />);
    expect(html).toContain(`>${title}</h1>`);
    if (pathname === "/" || pathname === "/mandates/new") {
      expect(html).toContain('id="mandate-description"');
      expect(html).not.toContain("Loading create a mandate");
    } else if (pathname !== "/mandates") expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="status"');
    expect(html).not.toMatch(/unipile|firmable|n8n/i);
    if (!["/", "/mandates/new", "/mandates"].includes(pathname)) expect(html).toContain("motion-reduce:animate-none");
  });

  it("keeps the people header and navigation visible when URL parameters suspend", () => {
    Object.assign(location, { pathname: "/mandates/example/people", suspended: true });
    const html = renderToStaticMarkup(<PageLoading />);
    expect(html).toContain(">People</h1>");
    expect(html).toContain('href="/mandates/example?tab=targets"');
    expect(html).toContain("Loading people…");
    location.suspended = false;
  });

  it("provides a preloadable loading boundary for every page", () => {
    function checkPages(directory: string) {
      const entries = readdirSync(directory, { withFileTypes: true });
      if (entries.some(entry => entry.name === "page.tsx")) {
        expect(readFileSync(join(directory, "loading.tsx"), "utf8")).toContain("PageLoading as default");
      }
      entries.filter(entry => entry.isDirectory()).forEach(entry => checkPages(join(directory, entry.name)));
    }
    checkPages(join(process.cwd(), "src/app"));
  });
});
