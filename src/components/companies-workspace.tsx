"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { MandateView, MembershipView } from '@/domain/acquisition';
import { defaultCompanyListQuery, type CompanyList, type CompanyListQuery, type CompanySummary } from '@/domain/company-list';
import { MandateFitSummaryCells } from './mandate-fit-cells';
import { TargetReviewRow } from './target-review-row';
import { SidebarRegistration } from './app-shell';
import { CompanyReviewPanel } from './company-review-panel';
import { ContactEnrichmentProgress } from './contact-enrichment-progress';
import { useActivePolling } from './use-active-polling';
import { mandateTabHref } from '@/domain/mandate-navigation';
import { providerNeutralText } from '@/domain/provider-display';
import { clearDiscoveredCompanies, discoveredCompaniesFor } from './company-discovery-handoff';

const fieldClass = 'mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--panel-raised)] p-2 text-sm text-[var(--foreground)]';
async function read(url: string, signal?: AbortSignal, method = 'GET') {
  const response = await fetch(url, { signal, method, cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not load companies');
  return data;
}
export function CompaniesWorkspace({ mandates, initial }: { mandates: MandateView[]; initial: CompanyList }) {
  const [data, setData] = useState(() => discoveredCompaniesFor(initial)), [query, setQuery] = useState<CompanyListQuery>(defaultCompanyListQuery);
  const [selected, setSelected] = useState<string[]>([]), [review, setReview] = useState<CompanySummary | null>(null);
  const [enriching, setEnriching] = useState<string[] | null>(null), [error, setError] = useState('');
  const revision = useRef(data.revision), sequence = useRef(0), controller = useRef<AbortController | null>(null);
  const id = initial.mandate.id;
  useEffect(() => { clearDiscoveredCompanies(id); }, [id]);
  const queryKey = JSON.stringify(query);
  const refresh = useCallback(async () => {
    const current = ++sequence.current;
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    const params = new URLSearchParams(Object.entries(query).map(([key,value]) => [key,String(value)]));
    if (revision.current) params.set('revision', revision.current);
    try {
      const next: CompanyList | { unchanged: true; active: boolean; revision: string } = await read(`/api/mandates/${id}/companies?${params}`, abort.signal);
      if (current !== sequence.current) return;
      revision.current = next.revision;
      if ('unchanged' in next) setData(previous => ({ ...previous, active: next.active }));
      else setData(next);
      setError('');
    } catch (cause) { if (!abort.signal.aborted && current === sequence.current) setError((cause as Error).message); }
  }, [id, query]);
  useEffect(() => () => controller.current?.abort(), []);
  useActivePolling(refresh, { active: data.active && !enriching, intervalMs: 5000, key: `${id}:${queryKey}` });
  const recover = useCallback(async () => { try { await read(`/api/mandates/${id}/companies`, undefined, 'POST'); } catch { /* Subsequent recovery retries. */ } }, [id]);
  useActivePolling(recover, { active: data.active && !enriching, intervalMs: 30000, key: id });
  const change = (key: keyof CompanyListQuery, value: string | number) => setQuery(previous => ({ ...previous, [key]: value, page: key === 'page' ? Number(value) : 1 }));
  const pageIds = data.rows.map(row => row.id), allSelected = pageIds.length > 0 && pageIds.every(value => selected.includes(value));
  const navigation = <SidebarRegistration value={{ mandates: mandates.map(m => ({ id: m.id, name: m.id === id ? data.mandate.brief.name : m.brief.name })), selected: id, tab: 'targets' }} />;
  if (enriching) return <>{navigation}<div className="p-5 sm:p-8"><ContactEnrichmentProgress mandateId={id} targetIds={enriching} onBack={() => { setEnriching(null); revision.current = ''; void refresh(); }} /></div></>;
  return <>{navigation}<div className="space-y-5 p-5 sm:p-8">
    <header><p className="text-xs uppercase tracking-widest text-[var(--accent)]">Acquisition workspace</p><h1 className="mt-2 text-3xl font-semibold">{data.mandate.brief.name}</h1></header>
    <section className="space-y-3"><h2 className="text-xl font-semibold">Companies</h2><p className="text-sm text-[var(--muted)]">Companies appear as they are found. Open a company to view its research, financials and decision-makers.</p></section>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(12rem,2fr)_repeat(4,minmax(8rem,1fr))] xl:items-end">
      <label className="text-xs">Find company or website<input className={fieldClass} value={query.search} onChange={e => change('search',e.target.value)} placeholder="Name or domain" /></label>
      <label className="text-xs">Stage<select className={fieldClass} value={query.stage} onChange={e => change('stage',e.target.value)}>{['all','identified','reviewing','shortlisted','outreach-approved','contacted','in-conversation','qualified','parked','excluded'].map(value => <option key={value} value={value}>{value === 'all' ? 'All stages' : value}</option>)}</select></label>
      <label className="text-xs">Research<select className={fieldClass} value={query.research} onChange={e => change('research',e.target.value)}><option value="all">All research</option><option value="researching">Researching</option><option value="ready">Ready to review</option><option value="needs-evidence">Needs evidence</option></select></label>
      <label className="text-xs">Data found<select className={fieldClass} value={query.data} onChange={e => change('data',e.target.value)}><option value="all">Any data</option><option value="headcount">Headcount</option><option value="revenue">Revenue</option><option value="person">Decision-maker</option></select></label>
      <label className="text-xs">Accreditation<input className={fieldClass} value={query.accreditation} onChange={e => change('accreditation',e.target.value)} placeholder="Issuer or scope" /></label>
    </div>
    {error && <p role="alert" className="text-sm">{error}</p>}
    <div className="flex flex-wrap items-center justify-end gap-3">{selected.length > 0 && <button className="text-xs underline" onClick={() => setSelected([])}>Clear selection</button>}<div className="flex max-w-sm flex-col gap-2"><button className="rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[var(--on-accent)] disabled:cursor-not-allowed disabled:bg-neutral-400 disabled:text-white" disabled={selected.length === 0 || selected.length > 20} onClick={() => setEnriching([...selected])}>Find phone numbers →</button>{selected.length > 20 && <p className="text-xs text-[var(--muted)]">Select 20 or fewer businesses ({selected.length} selected)</p>}</div></div>
    {selected.length > 0 && <p className="text-xs text-[var(--muted)]">Retrieve phone numbers for existing contacts at the selected businesses. This uses credits; people and emails are retrieved during Find Companies.</p>}
    {Boolean(data.enrichment?.length) && <p role="status" className="text-sm text-[var(--accent)]">{data.enrichment!.map(run => `${run.name}: ${providerNeutralText(run.message)}${run.profilesFound ? ` (${run.profilesSaved}/${run.profilesFound} profiles saved${run.profilesFailed ? `, ${run.profilesFailed} failed` : ''})` : ''}`).join(' · ')}</p>}
    <div className="overflow-x-auto rounded-lg border border-[var(--border)]"><table className="w-full min-w-[720px] text-left text-sm [&_td]:align-top"><thead className="bg-[var(--panel)]"><tr><th className="p-3"><label className="flex items-center gap-2"><input type="checkbox" aria-label="Select all matching businesses on this page" checked={allSelected} disabled={!pageIds.length} onChange={e => setSelected(previous => e.target.checked ? [...new Set([...previous,...pageIds])] : previous.filter(value => !pageIds.includes(value)))} />Select</label></th>{['Company','Fit','Reason for fit'].map(value => <th className="p-3" key={value}>{value}</th>)}</tr></thead><tbody>
      {data.rows.map(row => <TargetReviewRow key={row.id} companyName={row.name} onReview={() => setReview(row)}><td className="p-3"><input type="checkbox" aria-label={`Select ${row.name}`} checked={selected.includes(row.id)} onChange={e => setSelected(previous => e.target.checked ? [...new Set([...previous,row.id])] : previous.filter(value => value !== row.id))} /></td><td className="w-80 p-3"><button className="min-h-12 text-left font-semibold underline decoration-[var(--border)] underline-offset-4" onClick={() => setReview(row)}>{row.name}</button></td><MandateFitSummaryCells fit={row.fit} mandateId={id} /></TargetReviewRow>)}
      {!data.rows.length && <tr><td colSpan={4} className="p-8 text-[var(--muted)]">{data.hasResearch || data.total ? 'No companies match these filters. New companies will appear as they are found.' : <>No companies yet. <Link className="underline" href={mandateTabHref(id,'brief')}>Find businesses or import sourced records in Brief</Link> to start your review.</>}</td></tr>}
    </tbody></table></div>
    {data.pages > 1 && <nav aria-label="Company pages" className="flex items-center justify-between"><button disabled={data.page <= 1} onClick={() => change('page',data.page-1)}>Previous</button><span className="text-sm">Page {data.page} of {data.pages} · {data.total} companies</span><button disabled={data.page >= data.pages} onClick={() => change('page',data.page+1)}>Next</button></nav>}
  </div>{review && <CompanyDetails key={review.id} mandate={data.mandate} row={review} onClose={() => setReview(null)} />}</>;
}

function CompanyDetails({ mandate, row, onClose }: { mandate: MandateView; row: CompanySummary; onClose: () => void }) {
  const [member,setMember] = useState<MembershipView>(), [error,setError] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    void read(`/api/mandates/${mandate.id}/companies/${row.id}`,abort.signal).then(data => setMember(data.member)).catch(cause => { if (!abort.signal.aborted) setError(cause.message); });
    return () => abort.abort();
  }, [mandate.id,row.id]);
  if (member) return <CompanyReviewPanel mandate={mandate} initial={member} position="Company" onClose={onClose} />;
  return <div role="dialog" aria-modal="true" aria-label={row.name} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"><div className="rounded-lg bg-[var(--background)] p-8"><p role={error ? 'alert' : 'status'}>{error || `Loading ${row.name}…`}</p><button className="mt-4 underline" onClick={onClose}>Close</button></div></div>;
}
