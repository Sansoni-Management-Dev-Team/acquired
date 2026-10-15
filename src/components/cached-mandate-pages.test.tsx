import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { emptyBrief } from "@/domain/acquisition";
import { CachedMandateCreate, CachedMandatesPage, MandatePicker } from "./cached-mandate-pages";
import { AppShell } from "./app-shell";

const state = vi.hoisted(() => ({ cache: { mandates: [] as { id: string; brief: ReturnType<typeof emptyBrief>; createdAt: string }[], loaded: false, error: "", refreshing: false, retry: vi.fn() }, pathname: "/" }));
vi.mock("./use-cached-mandates", () => ({ useCachedMandates: () => state.cache, useCachedSession: () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname, useSearchParams: () => new URLSearchParams(), useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("./campaign-reply-alerts", () => ({ CampaignReplyAlerts: () => null }));
beforeEach(() => { state.pathname = "/"; Object.assign(state.cache, { mandates: [], loaded: false, error: "", refreshing: false }); });

it("renders an editable creation form before authentication or history finishes", () => {
  const html = renderToStaticMarkup(<CachedMandateCreate />);
  expect(html).toContain('id="mandate-description"');
  expect(html).toContain("Find companies");
  expect(html).not.toContain("Loading create a mandate");
  expect(html).not.toContain("Your mandates will appear here");
});

it("keeps cached mandate cards visible during refresh and a refresh failure", () => {
  Object.assign(state.cache, { mandates: [{ id: "example", brief: { ...emptyBrief(), name: "Cached cleaning mandate" }, createdAt: "2026-10-14T00:00:00Z" }], loaded: true, refreshing: true, error: "Could not refresh mandates." });
  const html = renderToStaticMarkup(<CachedMandatesPage />);
  expect(html).toContain("Cached cleaning mandate");
  expect(html).toContain("Retry");
  expect(html).not.toContain("Loading acquisition mandates");
});

it.each([
  ["brief", "/mandates/example?tab=brief"],
  ["targets", "/mandates/example?tab=targets"],
  ["people", "/mandates/example/people"],
  ["sequences", "/mandates/example/outreach/sequences"],
] as const)("opens the selected mandate's %s section and offers the home creation form", (section, href) => {
  Object.assign(state.cache, { mandates: [{ id: "example", brief: emptyBrief(), createdAt: "2026-10-14T00:00:00Z" }], loaded: true });
  const html = renderToStaticMarkup(<MandatePicker section={section} />);
  expect(html).toContain(`href="${href}"`);
  expect(html).toContain('href="/"');
  expect(html).toContain("Create a new mandate");
});

it.each(["/", "/mandates", "/mandates/example?tab=targets"])("always displays the four section links on %s", pathname => {
  state.pathname = pathname;
  const html = renderToStaticMarkup(<AppShell><div>Content</div></AppShell>);
  for (const section of ["brief", "targets", "people", "sequences"]) expect(html).toContain(`href="/mandates/select/${section}"`);
});
