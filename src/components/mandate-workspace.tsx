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
export async function jsonRequest(url: string, body?: unknown) {
  const response = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const data = await response.json();
  if (!response.ok) throw new Error(providerNeutralText(data.error || "Request failed"));
  return data;
}
export function MandateNavigation({ mandates, selected, tab = "brief" }: { mandates: MandateView[]; selected?: string; tab?: string }) {
  return <SidebarRegistration value={{ mandates: mandates.map(m => ({ id: m.id, name: m.brief.name })), selected, tab }} />;
}

export function MandateWorkspace({ mandates, initial, tab, initialCompanies, learningEnabled=false }: { learningEnabled?:boolean; mandates: MandateView[]; initial: WorkspaceData; tab: string; initialCompanies?: CompanyList }) {
  if (tab === 'targets') {
    const companies = initialCompanies || { mandate: initial.mandate, revision: '', active: false, hasResearch: false, ...companyListPage(initial.memberships.map(member => summariseCompany(member,initial.mandate,[],initial.contacts.some(c => c.targetId === member.target.id && Boolean(c.name?.trim())))), defaultCompanyListQuery) };
    return <CompaniesWorkspace learningEnabled={learningEnabled} mandates={mandates} initial={companies} />;
  }
  return <LegacyMandateWorkspace mandates={mandates} initial={initial} tab={tab} />;
}
function LegacyMandateWorkspace({ mandates, initial, tab }: { mandates: MandateView[]; initial: WorkspaceData; tab: string }) {
  const [mandate, setMandate] = useState(initial.mandate);
  return <><MandateNavigation mandates={mandates.map(m => m.id === mandate.id ? mandate : m)} selected={mandate.id} tab={tab} /><div className="space-y-5 p-5 sm:p-8"><MandateBriefForm key={mandate.id} mandateId={mandate.id} brief={mandate.brief} revision={mandate.revision} onSaved={(brief,revision) => setMandate(current => ({ ...current, brief,revision }))} /></div></>;
}
