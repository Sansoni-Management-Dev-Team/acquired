import Link from "next/link";
import { pipelineColumn } from "@/domain/pipeline-board";
import { useState } from "react";
import type { MembershipView } from "@/domain/acquisition";

const dealStages = [
  ["found", "Found"],
  ["shortlisted", "Shortlisted"],
  ["outreach-approved", "Outreach approved"],
  ["contacted", "Contacted"],
  ["in-conversation", "In conversation"],
  ["qualified", "Qualified"],
] as const;

export function PipelineBoard({ mandateId, memberships, onReview, onShortlist, busy = false }: { mandateId: string; memberships: MembershipView[]; onReview?: (id: string) => void; onShortlist?: (member: MembershipView) => void; busy?: boolean }) {
  const [query, setQuery] = useState("");
  const [dragging, setDragging] = useState<string | null>(null);
  const [overShortlist, setOverShortlist] = useState(false);
  const active = memberships.filter(member => dealStages.some(([stage]) => pipelineColumn(member.assessment.stage) === stage));
  const archived = memberships.filter(member => ["parked", "excluded"].includes(member.assessment.stage));
  const matches = (member: MembershipView) => member.target.companyName.toLowerCase().includes(query.trim().toLowerCase());

  function card(member: MembershipView) {
    return <li key={member.target.id}
      draggable={!busy && Boolean(onShortlist) && pipelineColumn(member.assessment.stage) === "found"}
      onDragStart={event => {
        if (busy || !onShortlist || pipelineColumn(member.assessment.stage) !== "found") { event.preventDefault(); return; }
        event.dataTransfer.setData("application/x-acquired-target", member.target.id);
        event.dataTransfer.effectAllowed = "move";
        setDragging(member.target.id);
      }}
      onDragEnd={() => { setDragging(null); setOverShortlist(false); }}
      className={`min-w-0 rounded-lg border border-[var(--border)] bg-black p-4 ${dragging === member.target.id ? "opacity-50" : ""}`}>

      <Link draggable={false} href={`/mandates/${mandateId}/targets/${member.target.id}`} className="break-words font-semibold underline decoration-[var(--border)] underline-offset-4">{member.target.companyName}</Link>
      <p className="mt-2 break-words text-xs text-[var(--muted)]">{member.target.state} · {member.target.sector.value || "Classification unresolved"}</p>
      <p className="mt-5 text-xs text-[var(--muted)]">Next action</p>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm">{member.assessment.nextAction || "Open the worksheet to set a next action."}</p>
      {member.assessment.reason && <p className="mt-3 whitespace-pre-wrap break-words text-xs text-[var(--muted)]">{member.assessment.reason}</p>}
      {pipelineColumn(member.assessment.stage) === "found" && onShortlist && <button disabled={busy} onClick={() => onShortlist(member)} className="mt-4 mr-4 min-h-12 rounded-md border border-[var(--border)] px-3 text-sm disabled:opacity-40" aria-label={`Shortlist ${member.target.companyName}`}>Shortlist</button>}
      {onReview ? <button className="mt-4 min-h-12 text-sm underline" onClick={() => onReview(member.target.id)}>Review company</button> : <Link href={`/mandates/${mandateId}/targets/${member.target.id}`} className="mt-4 inline-block text-xs underline underline-offset-4">Review company</Link>}
    </li>;
  }

  return <section aria-labelledby="pipeline-heading" className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h2 id="pipeline-heading" className="text-xl font-semibold">Pipeline</h2><p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">Drag a business from Found into Shortlisted, or use its Shortlist button. Open a company to review evidence, contacts and drafts.</p></div>
      <Link href={`/mandates/${mandateId}?tab=targets`} className="rounded-md border border-[var(--border)] px-3 py-2 text-sm">Review targets</Link>
    </div>
    <p className="text-sm text-[var(--muted)]">{active.length} active deals · {archived.length} parked or excluded</p>
    {active.length === 0 ? <div className="rounded-xl border border-dashed border-[var(--border)] p-8">
      <h3 className="font-semibold">No businesses found yet</h3>
      <p className="mt-2 text-sm text-[var(--muted)]">Find or import businesses in Targets. They will appear in Found, ready to review and shortlist.</p>
    </div> : <>
      <label className="block max-w-sm text-xs">Find a deal<input value={query} onChange={event => setQuery(event.target.value)} className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--panel-raised)] p-2 text-sm text-white" /></label>
      {query && !active.some(matches) && <p role="status" className="text-sm text-[var(--muted)]">No active deals match “{query}”.</p>}
      <div className="grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {dealStages.map(([stage, label]) => {
          const members = active.filter(member => pipelineColumn(member.assessment.stage) === stage && matches(member));
          return <section key={stage} aria-label={label}
            onDragOver={event => {
              if (stage !== "shortlisted" || busy || !dragging || !onShortlist) return;
              event.preventDefault(); event.dataTransfer.dropEffect = "move"; setOverShortlist(true);
            }}
            onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOverShortlist(false); }}
            onDrop={event => {
              if (stage !== "shortlisted" || busy || !onShortlist) return;
              event.preventDefault(); setOverShortlist(false);
              const id = event.dataTransfer.getData("application/x-acquired-target");
              const member = active.find(member => member.target.id === id && id === dragging && pipelineColumn(member.assessment.stage) === "found");
              setDragging(null);
              if (member) onShortlist(member);
            }}
            className={`min-w-0 rounded-xl border bg-[var(--panel)] p-3 ${stage === "shortlisted" && overShortlist ? "border-[var(--accent)] ring-2 ring-[var(--accent)]" : "border-[var(--border)]"}`}>

            <h3 className="mb-4 flex items-center justify-between gap-2 text-sm font-semibold">{label}<span className="rounded bg-[var(--panel-raised)] px-2 py-1 text-xs">{members.length}</span></h3>
            {members.length ? <ul className="space-y-3">{members.map(card)}</ul> : <p className="py-5 text-xs text-[var(--muted)]">{stage === "shortlisted" ? "Drop a found business here to shortlist it." : "No deals in this stage."}</p>}
          </section>;
        })}
      </div>
    </>}
    {archived.length > 0 && <details className="rounded-xl border border-[var(--border)] p-4">
      <summary className="cursor-pointer text-sm font-semibold">Parked and excluded ({archived.length})</summary>
      {(["parked", "excluded"] as const).map(stage => <section key={stage} className="mt-4"><h3 className="mb-3 text-sm capitalize">{stage}</h3><ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{archived.filter(member => pipelineColumn(member.assessment.stage) === stage).map(card)}</ul></section>)}
    </details>}
  </section>;
}
