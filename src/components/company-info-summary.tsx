import type { ReactNode } from "react";
import type { MembershipView } from "@/domain/acquisition";
import { isCompanyDataSource, COMPANY_DATA_SOURCE } from "@/domain/provider-display";
import { estimateEbitda } from "@/domain/estimated-ebitda";
import { TargetResearchData, TargetEbitdaData } from "./target-research-data";

const known = (value?: string | null) => Boolean(value?.trim() && !/^(unknown|unavailable|classification unresolved|unspecified|n\/a)$/i.test(value.trim()));

export function CompanyInfoSummary({ member }: { member: MembershipView }) {
  const { target } = member;
  const findings = member.researchFindings || [];
  const preferredHeadcount = target.headcount.value !== null && isCompanyDataSource(target.headcount.provenance.source) ? target.headcount.value : undefined;
  const hasHeadcount = target.headcount.value !== null || findings.some(f => f.evidence.kind === "headcount");
  const hasRevenue = target.revenue.value !== null || findings.some(f => f.evidence.kind === "revenue");
  const hasEbitda = estimateEbitda(findings, undefined, preferredHeadcount === undefined ? undefined : { value: preferredHeadcount, source: "company data" }).status === "estimated";
  const industry = known(target.sector.value) ? target.sector.value : [...new Set(findings.filter(f => f.evidence.kind === "industry").map(f => f.evidence.value).filter(known))].join(" · ");
  const location = [target.suburb, target.state].filter(known).join(", ") || [...new Set(findings.filter(f => f.evidence.kind === "location").map(f => f.evidence.value).filter(known))].join(" · ");
  const company = target.sourceData?.firmable;
  const details = company?.companyDetails;
  const address = details?.address && typeof details.address === "object" ? (details.address as Record<string, unknown>).full_address : undefined;
  const locations = Array.isArray(details?.locations) ? details.locations.map(value => typeof value === "string" ? value : value && typeof value === "object" ? (value as Record<string, unknown>).name : undefined).filter((value): value is string => typeof value === "string") : company?.locations || [];
  const codes = company?.rawResponse?.industry_codes as Record<string, unknown> | undefined;
  const description = target.sourceData?.firmable?.description || target.sourceData?.manufacturingDirectory?.description;
  const founded = target.establishedYear.value ?? findings.find(f => f.evidence.kind === "founded_year")?.evidence.value;
  const hasData = hasHeadcount || hasRevenue || hasEbitda || known(industry) || known(location) || known(target.abn) || known(description) || founded != null || Boolean(company);
  return <section aria-labelledby="company-info-heading" className="space-y-5">
    <h3 id="company-info-heading" className="text-lg font-semibold">Company information</h3>
    {!hasData ? <p className="rounded-[14px] bg-[var(--panel)] p-5 text-sm text-[var(--muted)]">No company details found yet.</p> : <>
      {known(description) && <p className="text-sm leading-relaxed text-[var(--muted)]">{description}</p>}
      <dl className="grid grid-cols-1 gap-x-8 gap-y-6 rounded-[14px] bg-[var(--panel)] p-5 text-sm sm:grid-cols-2">
        {known(industry) && <Info label="Industry">{industry}</Info>}
        {known(location) && <Info label="Location">{location}</Info>}
        {hasHeadcount && <Info label="Headcount"><TargetResearchData findings={findings} kind="headcount" fallback={target.headcount.value?.toLocaleString("en-AU") ?? ""} preferred={preferredHeadcount !== undefined ? { value: preferredHeadcount.toLocaleString("en-AU"), source: COMPANY_DATA_SOURCE, sourceUrl: target.headcount.provenance.sourceUrl } : undefined} /></Info>}
        {hasRevenue && <Info label="Revenue (source currency)"><TargetResearchData findings={findings} kind="revenue" fallback={target.revenue.value == null ? "" : `${financialValue(target.revenue.value)} AUD`} preferred={target.revenue.value !== null && isCompanyDataSource(target.revenue.provenance.source) ? { value: financialValue(target.revenue.value), source: COMPANY_DATA_SOURCE, sourceUrl: target.revenue.provenance.sourceUrl } : undefined} /></Info>}
        {hasEbitda && <Info label="Estimated EBITDA (AUD)"><TargetEbitdaData findings={findings} preferredHeadcount={preferredHeadcount} /></Info>}
        {founded != null && <Info label="Established">{founded}</Info>}
        {known(target.abn) && <Info label="ABN">{target.abn}</Info>}
        {known(company?.acn) && <Info label="ACN">{company?.acn}</Info>}
        {known(company?.companyType) && <Info label="Company type">{company?.companyType}</Info>}
        {known(company?.companySize) && <Info label="Employee band">{company?.companySize}</Info>}
        {typeof address === "string" && known(address) && <Info label="Address">{address}</Info>}
        {locations.length > 0 && <Info label="Company locations">{locations.join(" · ")}</Info>}
        {company?.companyEmails?.length ? <Info label="Company emails">{company.companyEmails.map(email => <p key={email}>{email}</p>)}</Info> : null}
        {company?.companyPhones?.length ? <Info label="Company phone numbers">{company.companyPhones.map(phone => <p key={phone}>{phone}</p>)}</Info> : null}
        {company?.availablePeopleCount != null && <Info label="Available people profiles">{company.availablePeopleCount.toLocaleString("en-AU")}</Info>}
        {known(company?.anzsic) && <Info label="ANZSIC">{company?.anzsic}</Info>}
        {["naics", "sic"].map(code => typeof codes?.[code] === "string" && known(codes[code]) ? <Info key={code} label={code.toUpperCase()}>{codes[code] as string}</Info> : null)}
        {company?.keywords?.length ? <Info label="Keywords">{company.keywords.join(" · ")}</Info> : null}
      </dl>
    </>}
  </section>;
}

function Info({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0 space-y-2"><dt className="text-xs font-medium text-[var(--muted)]">{label}</dt><dd className="break-words">{children}</dd></div>;
}

function financialValue(value: NonNullable<MembershipView["target"]["revenue"]["value"]>) {
  const money = (amount: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(amount);
  return typeof value === "number" ? money(value) : value.kind === "range" ? `${money(value.min)}–${money(value.max)}` : value.label;
}
