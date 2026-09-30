"use client";

import { MandateBriefForm } from "./mandate-brief-form";

import { SidebarRegistration } from "./app-shell";
import { useState } from "react";
import { CompaniesWorkspace } from './companies-workspace';
import { companyListPage, defaultCompanyListQuery, summariseCompany, type CompanyList } from '@/domain/company-list';
import { type CoverageRun, type MandateView, type MembershipView, type ValuationObservation } from "@/domain/acquisition";
import { BuyerProfile } from "@/domain/buyer-profile";
import { providerNeutralText } from "@/domain/provider-display";

export const fieldClass = "mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--panel-raised)] p-2 text-sm text-[var(--foreground)]";
export const buttonClass = "rounded-md border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--panel-raised)] disabled:opacity-40";
export const panelClass = "rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5";
type ContactSummary = { targetId: string; name: string; role: string | null; reachable: boolean };
type FirmableRefreshSummary = { id: string; targetId: string; status: string; profilesFound: number; profilesSaved: number; profilesFailed: number; message: string };
export type WorkspaceData = { mandate: MandateView; memberships: MembershipView[]; coverage: CoverageRun[]; valuations: ValuationObservation[]; buyerProfile: BuyerProfile | null; contacts: ContactSummary[]; firmableRefreshes: FirmableRefreshSummary[] };
export function CompanyDataAction({ selectedCount, busy, onClick }: { selectedCount: number; busy: boolean; onClick: () => void }) {
  return <div className="flex max-w-sm flex-col gap-2"><button type="button" className="rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[var(--on-accent)] hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:bg-neutral-400 disabled:text-white" disabled={busy || selectedCount === 0 || selectedCount > 20} onClick={onClick}>Enrich selected companies →</button>{selectedCount > 20 && <p className="text-xs text-[var(--muted)]">Select 20 or fewer businesses ({selectedCount} selected)</p>}</div>;
}
export async function jsonRequest(url: string, body?: unknown) {
  const response = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const data = await response.json();
  if (!response.ok) throw new Error(providerNeutralText(data.error || "Request failed"));
  return data;
}
export function MandateNavigation({ mandates, selected, tab = "brief" }: { mandates: MandateView[]; selected?: string; tab?: string }) {
  return <SidebarRegistration value={{ mandates: mandates.map(m => ({ id: m.id, name: m.brief.name })), selected, tab }} />;
}

export function MandateWorkspace({ mandates, initial, tab, initialCompanies }: { mandates: MandateView[]; initial: WorkspaceData; tab: string; initialCompanies?: CompanyList }) {
  if (tab === 'targets') {
    const companies = initialCompanies || { mandate: initial.mandate, revision: '', active: false, hasResearch: false, ...companyListPage(initial.memberships.map(member => summariseCompany(member,initial.mandate,[],initial.contacts.some(c => c.targetId === member.target.id && Boolean(c.name?.trim())))), defaultCompanyListQuery) };
    return <CompaniesWorkspace mandates={mandates} initial={companies} />;
  }
  return <LegacyMandateWorkspace mandates={mandates} initial={initial} tab={tab} />;
}
function LegacyMandateWorkspace({ mandates, initial, tab }: { mandates: MandateView[]; initial: WorkspaceData; tab: string }) {
  const [mandate, setMandate] = useState(initial.mandate);
  return <><MandateNavigation mandates={mandates.map(m => m.id === mandate.id ? mandate : m)} selected={mandate.id} tab={tab} /><div className="space-y-5 p-5 sm:p-8"><MandateBriefForm mandateId={mandate.id} brief={mandate.brief} onSaved={brief => setMandate(current => ({ ...current, brief }))} /></div></>;
}
export function CoveragePanel({ data }: { data: WorkspaceData }) {
  const all = data.memberships;
  const classified = all.filter(m => m.assessment.evidence.some(e => e.criterionKey === "subsectors" && e.assessment === "supported"));
  const sized = classified.filter(m => m.target.revenue.value !== null || m.target.headcount.value !== null);
  const named = sized.filter(m => data.contacts.some(c => c.targetId === m.target.id && /owner|founder|director|principal/i.test(c.role || "") && c.name));
  const reachable = named.filter(m => data.contacts.some(c => c.targetId === m.target.id && /owner|founder|director|principal/i.test(c.role || "") && c.reachable));
  return <><div className="grid gap-3 md:grid-cols-5">{[["Entities", all.length], ["Sub-sector confirmed", classified.length], ["Size populated", sized.length], ["Named owner / principal", named.length], ["Reachable contact", reachable.length]].map(([label,count]) => <div className={panelClass} key={label}><p className="text-2xl font-semibold">{count}</p><p className="mt-2 text-xs text-[var(--muted)]">{label}</p></div>)}</div><p className="text-xs text-[var(--muted)]">Sequential funnel for this mandate. Contact roles require review; size may be modelled. No national coverage percentage is claimed.</p><div className={panelClass}><h2 className="text-xl font-semibold">Source coverage history</h2>{!data.coverage.length && <p className="mt-3 text-sm text-[var(--muted)]">No sources searched yet.</p>}{data.coverage.map(run => <div key={run.id} className="mt-5 overflow-x-auto"><p className="mb-2 text-xs text-[var(--muted)]">{`${run.createdAt.slice(0, 16).replace("T", " ")} UTC`}</p><table className="w-full min-w-[700px] text-left text-sm"><thead><tr>{["Source", "Status", "Records", "Unique additions", "Overlap", "Scope / gaps"].map(h => <th className="p-2" key={h}>{h}</th>)}</tr></thead><tbody>{run.sources.map(s => <tr key={s.name} className="border-t border-[var(--border)]"><td className="p-2">{s.name}</td><td className="p-2">{s.status}</td><td className="p-2">{s.discovered}</td><td className="p-2">{s.unique}</td><td className="p-2">{s.overlap}</td><td className="max-w-md p-2 text-xs text-[var(--muted)]">{s.note}</td></tr>)}</tbody></table></div>)}</div></>;
}
