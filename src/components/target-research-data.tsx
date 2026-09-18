import type { ReactNode } from "react";
import type { SavedResearchFinding } from "@/domain/research";
import { estimateEbitda } from "@/domain/estimated-ebitda";
import { parseHeadcount } from "@/domain/company-facts";
import { providerNeutralText } from "@/domain/provider-display";

const normalise = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
const disclosure = "min-h-12 cursor-pointer content-center rounded text-xs font-medium underline decoration-[var(--border)] underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2";
function averageRevenueLabel(groups: SavedResearchFinding[][]) {
  const observations = groups.map(group => group[0]);
  const parsed = observations.map(f => {
    const match = f.evidence.value.trim().match(/^(?:(AUD|USD|A\$|US\$|\$)\s*)?(\d[\d,]*(?:\.\d+)?)\s*(K|M|B|million|billion)?\.?$/i);
    if (!match) return null;
    const multiplier = /^(?:k)$/i.test(match[3] || "") ? 1_000 : /^(?:m|million)$/i.test(match[3] || "") ? 1_000_000 : /^(?:b|billion)$/i.test(match[3] || "") ? 1_000_000_000 : 1;
    const currency = f.evidence.factMetadata?.currency || (/^(?:AUD|A\$)$/i.test(match[1] || "") ? "AUD" : /^(?:USD|US\$)$/i.test(match[1] || "") ? "USD" : null);
    return { amount: Number(match[2].replaceAll(",", "")) * multiplier, currency, prefix: match[1] || "" };
  });
  if (parsed.some(value => !value)) return null;
  const values = parsed.filter((value): value is NonNullable<typeof value> => value !== null);
  const currencies = new Set(values.flatMap(value => value.currency ? [value.currency] : []));
  if (currencies.size > 1) return null;
  const average = values.reduce((sum, value) => sum + value.amount, 0) / values.length;
  const currency = currencies.values().next().value as string | undefined;
  if (currency) return new Intl.NumberFormat("en-AU", { style: "currency", currency, maximumFractionDigits: 0 }).format(average);
  const prefix = values.find(value => value.prefix)?.prefix || "";
  return `${prefix}${new Intl.NumberFormat("en-AU", { maximumFractionDigits: 0 }).format(average)}`;
}
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
  const conflicting = kind === "headcount" && new Set(groups.map(g => JSON.stringify(parseHeadcount(g[0].evidence.value) || g[0].evidence.value))).size > 1;
  const label = (f: SavedResearchFinding) => kind === "person" ? f.evidence.name : f.evidence.value;
  const preview = groups.slice(0, 2).map(g => label(g[0])).join(" · ");
  const peopleCount = savedPeople.length || groups.length;
  const peoplePreview = savedPeople.length ? savedPeople.slice(0, 2).join(" · ") : preview;
  const summary = preferred?.value || (kind === "revenue" && groups.length > 1 ? averageRevenueLabel(groups) || preview : preview);
  return <div className="max-w-64 space-y-1">
    {kind === "person" ? <><p className="font-medium">{peopleCount} {peopleCount === 1 ? "person" : "people"} found</p><p className="line-clamp-2 text-xs text-[var(--muted)]">{peoplePreview}{peopleCount > 2 ? ` +${peopleCount - 2} more` : ""}</p></> : <p className="line-clamp-2 font-medium">{summary}{!preferred && kind !== "revenue" && groups.length > 2 ? ` +${groups.length - 2} more` : ""}</p>}
    <p className={`text-xs ${!preferred && conflicting ? "text-[var(--status-amber)]" : "text-[var(--muted)]"}`}>{savedPeople.length ? "Saved contacts · preferred" : preferred ? `${providerNeutralText(preferred.source)} · preferred` : conflicting ? "Sources disagree" : kind === "person" ? "Roles unverified" : groups.every(g => g.every(f => f.evidence.factMetadata?.basis === "reported")) ? "Reported · awaiting review" : "Estimate · unverified"}</p>
    <details>
      <summary className={disclosure}>{kind === "person" ? `View ${peopleCount === 1 ? "person" : "people"} & sources` : "View observations & sources"}</summary>
      <div className="max-h-64 space-y-3 overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--panel)] p-3">
        {preferred && <section className="space-y-1"><p className="text-sm font-semibold">{preferred.value}</p><p className="text-xs text-[var(--muted)]">{providerNeutralText(preferred.source)} · preferred source</p>{preferred.sourceUrl && <a className="inline-flex min-h-12 items-center break-all text-xs underline" href={preferred.sourceUrl} target="_blank" rel="noreferrer">Provider-linked company website</a>}</section>}
        {savedPeople.length > 0 && <section className="space-y-1"><p className="text-sm font-semibold">Saved contacts</p>{savedPeople.map(name => <p className="text-xs" key={normalise(name)}>{name}</p>)}</section>}
        {groups.map(group => <section key={group[0].id} className="space-y-1"><p className="text-sm font-semibold">{label(group[0])}</p>{group.map(f => <div key={`${f.id}:${f.sourceUrl}`} className="text-xs">
          {kind === "person" && <p>{f.evidence.name} — {f.evidence.value}</p>}
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
  if (estimate.status !== "estimated") return <div className="max-w-56"><p className="text-[var(--muted)]">Unavailable</p><details><summary className={disclosure}>Why unavailable?</summary><p className="text-xs text-[var(--muted)]">{estimate.reason}</p></details></div>;
  const money = compactAud;
  return <div className="max-w-56"><p className="font-medium">{money(estimate.low!)} – {money(estimate.high!)}</p><p className="text-xs text-[var(--muted)]">Estimated annual EBITDA</p>{preferredHeadcount !== undefined ? <p className="text-xs text-[var(--muted)]">Preferred company headcount</p> : estimate.headcountAggregation?.method === "mean" && <p className="text-xs text-[var(--status-amber)]">Averaged headcount</p>}<details><summary className={disclosure}>View calculation</summary><div className="space-y-2 text-xs text-[var(--muted)]"><p>{estimate.benchmark!.label} · {estimate.headcountBasis} headcount</p><a className="inline-flex min-h-12 items-center underline" href={estimate.benchmark!.sourceUrl} target="_blank" rel="noreferrer">ABS {estimate.benchmark!.period}</a>{estimate.match?.needsReview && <p>Industry match needs review</p>}{preferredHeadcount !== undefined ? <p>Preferred company headcount: {preferredHeadcount.toLocaleString("en-AU")} people.</p> : estimate.headcountAggregation?.method === "mean" && <p>Mean of {estimate.headcountAggregation.observations} observations: {estimate.headcountAggregation.low.toLocaleString("en-AU", { maximumFractionDigits: 2 })}–{estimate.headcountAggregation.high.toLocaleString("en-AU", { maximumFractionDigits: 2 })} people. Range bounds averaged separately.</p>}<p>Headcount × historical EBITDA per employee. Indicative scenario; not reported earnings.</p></div></details></div>;
}
