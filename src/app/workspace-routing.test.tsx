import { renderToReadableStream } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { emptyBrief, initialAssessment } from "@/domain/acquisition";
import { companyListPage, defaultCompanyListQuery, summariseCompany, type CompanyList } from "@/domain/company-list";
import { rankTarget } from "@/domain/scoring";
import { defaultMandate, seedTargets } from "@/test/fixtures/scoring-targets";

const mocks = vi.hoisted(() => ({ session: vi.fn(), listMandates: vi.fn(), loadCompanies: vi.fn(), repository: vi.fn() }));
vi.mock("@/lib/acquisition-session", () => ({ acquisitionSession: mocks.session }));
vi.mock("@/db/acquisition-repository", () => ({ AcquisitionRepository: class {
  constructor(organizationId: string) { mocks.repository(organizationId); }
  listMandates = mocks.listMandates;
} }));
vi.mock("@/db/company-list-repository", () => ({ CompanyListRepository: class {
  constructor(organizationId: string) { mocks.repository(organizationId); }
  load = mocks.loadCompanies;
} }));
vi.mock("@/db/client", () => ({ requireDb: () => { throw new Error("Compact companies view must not load legacy workspace data"); } }));
vi.mock("@/db/firmable-read-model", () => ({ loadWorkspaceContacts: vi.fn() }));
vi.mock("@/db/firmable-history-repository", () => ({ FirmableHistoryRepository: vi.fn() }));
vi.mock("@/components/app-shell", () => ({ SidebarRegistration: () => null }));
vi.mock('next/server', () => ({ connection: async () => undefined }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("not-found"); },
  redirect: (href: string) => { throw new Error(`redirect:${href}`); },
  permanentRedirect: (href: string) => { throw new Error(`permanent-redirect:${href}`); },
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

import Home from "./page";
import MandatePage from "./mandates/[id]/page";
import LegacyOutreachPage from "./mandates/[id]/outreach/page";

const id = "00000000-0000-4000-8000-000000000001";
const mandate = { id, brief: { ...emptyBrief(), name: "Industrial acquisition" }, createdAt: "2026-10-09", updatedAt: "2026-10-09", version: 1 };
const member = { target: rankTarget(seedTargets[0], defaultMandate), assessment: initialAssessment, accreditations: [], version: 1 };
const companies: CompanyList = {
  mandate, revision: "saved-companies", active: true, hasResearch: true,
  ...companyListPage([summariseCompany(member, mandate, [], false)], defaultCompanyListQuery),
};

// Exercise the actual streamed page, including its async Suspense content and
// the client workspace it selects. Only authentication and persistence are fake.
async function renderPage(page: Parameters<typeof renderToReadableStream>[0]) {
  const errors: unknown[] = [];
  const stream = await renderToReadableStream(page, { onError: error => { errors.push(error); } });
  await stream.allReady;
  const html = await new Response(stream).text();
  if (errors.length) throw errors[0];
  return html;
}
const openMandate = (tab: string) => MandatePage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({ tab }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ organizationId: "org-a", userId: "user-a" });
  mocks.listMandates.mockResolvedValue([mandate]);
  mocks.loadCompanies.mockResolvedValue(companies);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unexpected network request")));
});
afterEach(() => { vi.unstubAllGlobals(); });

it("opens the cached mandate creation shell without server-side repository or provider work", async () => {
  const html = await renderPage(await Home());
  expect(html).toContain(">Create a mandate</h1>");
  expect(html).toContain('id="mandate-description"');
  expect(mocks.repository).not.toHaveBeenCalled();
  expect(mocks.listMandates).not.toHaveBeenCalled();
  expect(html).toContain("Loading your mandates");
  expect(fetch).not.toHaveBeenCalled();
});

it("streams saved companies through the compact companies workspace while research is active", async () => {
  const html = await renderPage(await openMandate("targets"));
  expect(html).toContain(member.target.companyName);
  expect(html).toContain(">Fit</th>");
  expect(html).toContain(">Reason for fit</th>");
  expect(html).toContain(`aria-label="Review ${member.target.companyName}"`);
  expect(mocks.loadCompanies).toHaveBeenCalledExactlyOnceWith(id, defaultCompanyListQuery);
  expect(mocks.repository.mock.calls).toEqual([["org-a"], ["org-a"]]);
  expect(fetch).not.toHaveBeenCalled();
});

it.each(["coverage", "discover", "pipeline"])("keeps the legacy %s tab linked to the active companies flow", async tab => {
  await expect(renderPage(await openMandate(tab))).rejects.toThrow(`redirect:/mandates/${id}?tab=targets`);
  expect(mocks.loadCompanies).not.toHaveBeenCalled();
});

it("links the legacy outreach tab to people", async () => {
  await expect(openMandate("outreach")).rejects.toThrow(`permanent-redirect:/mandates/${id}/people`);
  expect(mocks.session).not.toHaveBeenCalled();
});

it("links the legacy outreach page to people", async () => {
  await expect(LegacyOutreachPage({ params: Promise.resolve({ id }) })).rejects.toThrow(`permanent-redirect:/mandates/${id}/people`);
  expect(mocks.session).not.toHaveBeenCalled();
});

it("rejects an unavailable company list rather than exposing another organization's data", async () => {
  mocks.loadCompanies.mockResolvedValue(undefined);
  await expect(renderPage(await openMandate("targets"))).rejects.toThrow("not-found");
  expect(mocks.loadCompanies).toHaveBeenCalledExactlyOnceWith(id, defaultCompanyListQuery);
});

it("rejects invalid mandate IDs before any repository access", async () => {
  await expect(MandatePage({ params: Promise.resolve({ id: "invalid" }), searchParams: Promise.resolve({ tab: "targets" }) })).rejects.toThrow("not-found");
  expect(mocks.repository).not.toHaveBeenCalled();
});
