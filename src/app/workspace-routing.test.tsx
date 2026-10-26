import { renderToReadableStream } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { emptyBrief, initialAssessment } from "@/domain/acquisition";
import { companyListPage, defaultCompanyListQuery, summariseCompany, type CompanyList } from "@/domain/company-list";
import { rankTarget } from "@/domain/scoring";
import { defaultMandate, seedTargets } from "@/test/fixtures/scoring-targets";

const mocks = vi.hoisted(() => ({ session: vi.fn(), listMandates: vi.fn(), loadCompanies: vi.fn(), repository: vi.fn(), memberships: vi.fn() }));
vi.mock("@/lib/acquisition-session", () => ({ acquisitionSession: mocks.session }));
vi.mock("@/db/acquisition-repository", () => ({ AcquisitionRepository: class {
  constructor(organizationId: string) { mocks.repository(organizationId); }
  listMandates = mocks.listMandates;
  memberships = mocks.memberships;
} }));
vi.mock("@/db/company-list-repository", () => ({ CompanyListRepository: class {
  constructor(organizationId: string) { mocks.repository(organizationId); }
  load = mocks.loadCompanies;
} }));
vi.mock("@/db/client", () => ({ requireDb: () => { throw new Error("Compact companies view must not load legacy workspace data"); } }));
vi.mock("@/db/firmable-read-model", () => ({ loadWorkspaceContacts: vi.fn() }));
vi.mock("@/db/firmable-history-repository", () => ({ FirmableHistoryRepository: vi.fn() }));
vi.mock("@/components/app-shell", () => ({ SidebarRegistration: () => null }));
vi.mock("@/components/mandate-search-run", () => ({ MandateSearchRun: ({mandateId}:{mandateId:string}) => <div data-search-mandate={mandateId}>Preparing saved search</div> }));
vi.mock('next/server', () => ({ connection: async () => undefined }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("not-found"); },
  redirect: (href: string) => { throw new Error(`redirect:${href}`); },
  permanentRedirect: (href: string) => { throw new Error(`permanent-redirect:${href}`); },
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

import TargetPage from "./mandates/[id]/targets/[targetId]/page";
import Home from "./page";
import MandatePage from "./mandates/[id]/page";
import CompaniesPage from "./mandates/[id]/companies/page";
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
const openCompanies = () => CompaniesPage({ params: Promise.resolve({ id }) });
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
  const html = await renderPage(await openCompanies());
  expect(html).toContain(member.target.companyName);
  expect(html).toContain(">Fit</th>");
  expect(html).toContain(">Reason for fit</th>");
  expect(html).toContain(`aria-label="Review ${member.target.companyName}"`);
  expect(mocks.loadCompanies).toHaveBeenCalledExactlyOnceWith(id, defaultCompanyListQuery);
  expect(mocks.repository.mock.calls).toEqual([["org-a"], ["org-a"]]);
  expect(fetch).not.toHaveBeenCalled();
});

it("renders the canonical companies route for an owned mandate before its first company is saved", async () => {
  mocks.loadCompanies.mockResolvedValue({ ...companies, rows: [], total: 0, pages: 1 });
  const html = await renderPage(await openCompanies());
  expect(html).toContain(">Companies</h2>");
  expect(html).toContain("New companies will appear as they are found.");
  expect(mocks.loadCompanies).toHaveBeenCalledExactlyOnceWith(id, defaultCompanyListQuery);
  expect(mocks.repository.mock.calls).toEqual([["org-a"], ["org-a"]]);
  expect(fetch).not.toHaveBeenCalled();
});

it.each(["targets", "companies", "coverage", "discover", "pipeline"])("keeps the legacy %s tab linked to the active companies flow", async tab => {
  await expect(renderPage(await openMandate(tab))).rejects.toThrow(`redirect:/mandates/${id}/companies`);
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
  await expect(renderPage(await openCompanies())).rejects.toThrow("not-found");
  expect(mocks.loadCompanies).toHaveBeenCalledExactlyOnceWith(id, defaultCompanyListQuery);
});

it("rejects invalid mandate IDs before any repository access", async () => {
  await expect(MandatePage({ params: Promise.resolve({ id: "invalid" }), searchParams: Promise.resolve({ tab: "targets" }) })).rejects.toThrow("not-found");
  expect(mocks.repository).not.toHaveBeenCalled();
});

it('keeps queued company refresh messages out of the company table header',async()=>{
 mocks.loadCompanies.mockResolvedValue({...companies,enrichment:[{id:'queue-1',targetId:member.target.id,name:'Synthetic queue company',status:'queued',message:'Company data refresh queued',profilesFound:0,profilesSaved:0,profilesFailed:0},{id:'queue-2',targetId:member.target.id,name:'Synthetic loading company',status:'running',message:'Loading 3 profiles',profilesFound:50,profilesSaved:3,profilesFailed:0}]});
 const html=await renderPage(await openCompanies());
 expect(html).toContain(member.target.companyName);
 expect(html).not.toContain('Company data refresh queued');expect(html).not.toContain('Loading 3 profiles');expect(html).not.toContain('Synthetic queue company');
});

it('preserves company selection and filter parameters when redirecting an old company URL',async()=>{
 const page=await MandatePage({params:Promise.resolve({id}),searchParams:Promise.resolve({tab:'targets',targetId:'saved-company',page:'2',search:'water & pumps',tag:['one','two']})});
 await expect(renderPage(page)).rejects.toThrow(`redirect:/mandates/${id}/companies?targetId=saved-company&page=2&search=water+%26+pumps&tag=one&tag=two`);
});
it('does not load company data when the mandate is not in the authenticated organization',async()=>{
 mocks.listMandates.mockResolvedValue([]);await expect(renderPage(await openCompanies())).rejects.toThrow('not-found');expect(mocks.loadCompanies).not.toHaveBeenCalled();
});
it('rejects invalid canonical company IDs before loading a session or repository',async()=>{
 await expect(CompaniesPage({params:Promise.resolve({id:'invalid'})})).rejects.toThrow('not-found');expect(mocks.session).not.toHaveBeenCalled();expect(mocks.repository).not.toHaveBeenCalled();
});

it.each(['search enrich','search'])('opens authenticated %s progress before the new mandate row exists',async tab=>{
 mocks.listMandates.mockResolvedValue([]);
 const html=await renderPage(await openMandate(tab));
 expect(html).toContain(`data-search-mandate="${id}"`);
 expect(mocks.session).toHaveBeenCalledOnce();
 expect(mocks.repository).not.toHaveBeenCalled();
 expect(fetch).not.toHaveBeenCalled();
});


it("renders the selected company worksheet from an owned mandate membership", async () => {
  const targetId = "00000000-0000-4000-8000-000000000002";
  mocks.memberships.mockResolvedValue([{ ...member, target: { ...member.target, id: targetId } }]);
  const html = await renderPage(await TargetPage({ params: Promise.resolve({ id, targetId }) }));
  expect(html).toContain(member.target.companyName);
  expect(html).toContain(`href="/mandates/${id}/companies"`);
  expect(html).toContain("Pipeline and next action");
  expect(mocks.repository).toHaveBeenCalledWith("org-a");
  expect(mocks.memberships).toHaveBeenCalledWith(id);
  expect(fetch).not.toHaveBeenCalled();
});
it.each(["invalid", "00000000-0000-4000-8000-000000000002"])("rejects unavailable company %s without rendering a different company", async targetId => {
  mocks.memberships.mockResolvedValue([]);
  await expect(TargetPage({ params: Promise.resolve({ id, targetId }) })).rejects.toThrow("not-found");
});
it("does not read company memberships when the mandate is unavailable to this organization", async () => {
  mocks.listMandates.mockResolvedValue([]);
  await expect(TargetPage({ params: Promise.resolve({ id, targetId: "00000000-0000-4000-8000-000000000002" }) })).rejects.toThrow("not-found");
  expect(mocks.memberships).not.toHaveBeenCalled();
});
