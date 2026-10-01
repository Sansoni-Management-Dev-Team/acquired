import type { ReactNode } from "react";
import { DetailTooltip } from "./detail-tooltip";
import type { SavedResearchFinding } from "@/domain/research";
import { estimateEbitda } from "@/domain/estimated-ebitda";
import { parseHeadcount } from "@/domain/company-facts";
import { resolveCompanyField } from "@/domain/research-resolution";
import { providerNeutralText } from "@/domain/provider-display";

const normalise = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
const disclosure = "min-h-12 cursor-pointer content-center rounded text-xs font-medium underline decoration-[var(--border)] underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2";
export function groupTargetObservations(findings: SavedResearchFinding[], kind: "headcount" | "revenue" | "person") {
  const groups = new Map<string, SavedResearchFinding[]>();
  for (const f of findings.filter(f => f.evidence.kind === kind)) {
    const key = kind === "person" ? normalise(f.evidence.name) : JSON.stringify([kind === "headcount" ? parseHeadcount(f.evidence.value) || normalise(f.evidence.value) : normalise(f.evidence.value), f.evidence.factMetadata?.currency, f.evidence.factMetadata?.scope, f.evidence.factMetadata?.period]);
    const group = groups.get(key) || [];
    if (!group.some(other => other.sourceUrl === f.sourceUrl && normalise(other.evidence.value) === normalise(f.evidence.value) && other.evidence.factMetadata?.basis === f.evidence.factMetadata?.basis)) group.push(f);
    groups.set(key, group);
  }
  return [...groups.values()];
}
type PreferredObservation = { value: string; source: string; sourceUrl?: string };
type ConfirmedMissingObservation = { label: string; source: string };
export function TargetResearchData({ findings = [], kind, fallback, preferred, confirmedMissing }: { findings?: SavedResearchFinding[]; kind: "headcount" | "revenue" | "person"; fallback: ReactNode; preferred?: PreferredObservation; confirmedMissing?: ConfirmedMissingObservation }) {
  const groups = groupTargetObservations(findings, kind);
  const savedPeople = kind === "person" && typeof fallback === "string" && fallback !== "Unknown"
    ? [...new Map(fallback.split(", ").filter(Boolean).map(name => [normalise(name), name])).values()]
    : [];
  if (!groups.length && !preferred && !savedPeople.length) return confirmedMissing
    ? <div className="max-w-48"><p className="font-medium text-[var(--foreground)]">{confirmedMissing.label}</p><p className="text-xs text-[var(--status-amber)]">{providerNeutralText(confirmedMissing.source)} · checked</p></div>
    : <span className="text-[var(--muted)]">{fallback}</span>;
  const resolution = kind === "person" ? null : resolveCompanyField(kind === "headcount" ? "size" : "revenue", findings.map(f => f.evidence));
  const label = (f: SavedResearchFinding) => kind === "person" ? f.evidence.name : f.evidence.value;
  const preview = groups.slice(0, 2).map(g => label(g[0])).join(" · ");
  const peopleCount = savedPeople.length || groups.length;
  const peoplePreview = savedPeople.length ? savedPeople.slice(0, 2).join(" · ") : preview;
  const summary = preferred?.value || resolution?.selected?.value || (resolution?.status === "conflicting" ? "Sources disagree" : resolution?.observations.some(f => f.factMetadata?.basis === "search_snippet") ? "Search estimates only — unverified" : resolution?.observations.length ? "Unresolved observations" : preview);
  const statusLabel = savedPeople.length ? "Saved contacts · preferred" : preferred ? `${providerNeutralText(preferred.source)} · preferred` : kind === "person" ? `Roles unverified · ${findings.some(f => f.evidence.kind === "person" && f.evidence.email) ? "Published email found" : "Email unknown"}` : resolution?.status === "observed" ? "Reported · awaiting review" : resolution?.status === "estimated" ? "Estimate · awaiting review" : resolution?.status === "conflicting" ? "Sources disagree · awaiting review" : null;
  return <div className="max-w-64 space-y-1">
    {kind === "person" ? <><p className="font-medium">{peopleCount} {peopleCount === 1 ? "person" : "people"} found</p><p className="line-clamp-2 text-xs text-[var(--muted)]">{peoplePreview}{peopleCount > 2 ? ` +${peopleCount - 2} more` : ""}</p></> : <p className="line-clamp-2 font-medium">{summary}</p>}
    {statusLabel && <p className="text-xs text-[var(--muted)]">{statusLabel}</p>}
    <details>
      <summary className={disclosure}>{kind === "person" ? `View ${peopleCount === 1 ? "person" : "people"} & sources` : "View observations & sources"}</summary>
      <div className="max-h-64 space-y-3 overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--panel)] p-3">
        {preferred && <section className="space-y-1"><p className="text-sm font-semibold">{preferred.value}</p><p className="text-xs text-[var(--muted)]">{providerNeutralText(preferred.source)} · preferred source</p>{preferred.sourceUrl && <a className="inline-flex min-h-12 items-center break-all text-xs underline" href={preferred.sourceUrl} target="_blank" rel="noreferrer">Provider-linked company website</a>}</section>}
        {savedPeople.length > 0 && <section className="space-y-1"><p className="text-sm font-semibold">Saved contacts</p>{savedPeople.map(name => <p className="text-xs" key={normalise(name)}>{name}</p>)}</section>}
        {groups.map(group => <section key={group[0].id} className="space-y-1"><p className="text-sm font-semibold">{label(group[0])}</p>{group.map(f => <div key={`${f.id}:${f.sourceUrl}`} className="text-xs">
          {kind === "person" && <p>{f.evidence.name} — {f.evidence.value} · {f.evidence.email ? "Published email found" : "Email unknown"}</p>}
          {resolution?.superseded.includes(f.evidence) && <p className="text-[var(--muted)]">Superseded by stronger source</p>}
          <a className="inline-flex min-h-12 items-center break-all underline" href={f.sourceUrl} target="_blank" rel="noreferrer">{new URL(f.sourceUrl).hostname} · {new Date(f.observedAt).toLocaleDateString("en-AU")}</a>
          <p className="text-[var(--muted)]">{(f.evidence as typeof f.evidence & { source?: string }).source === "Apollo" ? "Apollo record — unverified" : f.evidence.factMetadata?.basis === "search_snippet" ? "Search estimate — unverified" : f.evidence.factMetadata?.basis === "third_party_estimate" ? "Third-party estimate" : "Published statement — awaiting review"}{kind === "revenue" ? ` · ${f.evidence.factMetadata?.currency || "Currency unknown"}` : ""}{f.evidence.factMetadata?.scope === "group" ? " · Group scope" : ""}{f.evidence.factMetadata?.period ? ` · ${f.evidence.factMetadata.period}` : ""}</p>
        </div>)}</section>)}
      </div>
    </details>
  </div>;
}

export function compactAud(value: number) {
  const absolute = Math.abs(value);
  const [divisor, suffix] = absolute >= 1_000_000_000 ? [1_000_000_000, "B"] : absolute >= 1_000_000 ? [1_000_000, "M"] : absolute >= 1_000 ? [1_000, "K"] : [1, ""];
  const amount = Math.round((value / divisor) * 100) / 100;
  return `$${amount}${suffix}`;
}

export function TargetEbitdaData({ findings = [], preferredHeadcount }: { findings?: SavedResearchFinding[]; preferredHeadcount?: number }) {
  const estimate = estimateEbitda(findings, undefined, preferredHeadcount === undefined ? undefined : { value: preferredHeadcount, source: "company data" });
  if (estimate.status !== "estimated") return <div className="max-w-56"><DetailTooltip content={estimate.reason}><span className="text-[var(--muted)]">Unavailable</span></DetailTooltip></div>;
  const money = compactAud;
  const approximation = (estimate.low! + estimate.high!) / 2;
  return <div className="max-w-56"><p className="font-medium">≈ {money(approximation)}</p><p className="text-xs text-[var(--muted)]">Estimated annual EBITDA</p>{preferredHeadcount !== undefined ? <p className="text-xs text-[var(--muted)]">Preferred company headcount</p> : estimate.headcountAggregation?.method === "mean" && <p className="text-xs text-[var(--status-amber)]">Averaged headcount</p>}</div>;
}
