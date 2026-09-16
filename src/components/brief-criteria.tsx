"use client";

import { useEffect, useRef, useState } from "react";
import { dialogBackdrop } from "./dialog-backdrop";
import { createPortal } from "react-dom";
import { criterionDefinitions, type Criterion } from "@/domain/acquisition";
import { GeographySelect } from "./geography-select";

const panel = "rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5";
const field = "mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--panel-raised)] p-2 text-sm text-[var(--foreground)]";
const button = "min-h-11 rounded-md border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--panel-raised)] disabled:opacity-40";
const labelFor = (c: Criterion) => criterionDefinitions.find(([key]) => key === c.key)![1];
const unresolved = (c: Criterion) => c.state === "unknown" || !c.confirmed;
const summary = (c: Criterion) => c.state === "unknown" ? "Not yet specified" : c.state === "unrestricted" ? "No restriction" : c.value;

export function BriefCriteria({ criteria, onChange }: { criteria: Criterion[]; onChange: (criteria: Criterion[]) => void }) {
  const [editing, setEditing] = useState(false);
  const questions = criteria.filter(unresolved);
  const primary = ["subsectors", "geography", "revenue", "headcount"];
  const extra = criteria.filter(c => !primary.includes(c.key) && c.state !== "unknown");
  return <section className={panel} aria-label="Acquisition criteria">
    <div className="flex items-center justify-between gap-4"><h2 className="text-lg font-semibold">Acquisition criteria</h2><button type="button" className={button} onClick={() => setEditing(true)}>Edit criteria</button></div>
    <dl className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-3">
      {criteria.filter(c => primary.includes(c.key)).map(c => <div key={c.key} className={c.key === "subsectors" ? "sm:col-span-3" : ""}>
        <dt className="text-xs text-[var(--muted)]">{labelFor(c)}</dt><dd className="mt-1 whitespace-pre-line break-words text-sm">{summary(c)}</dd>
      </div>)}
    </dl>
    {extra.length > 0 && <details className="mt-4 border-t border-[var(--border)] pt-3"><summary className="cursor-pointer text-sm">Additional criteria ({extra.length})</summary><dl className="mt-3 grid gap-3 sm:grid-cols-2">{extra.map(c => <div key={c.key}><dt className="text-xs text-[var(--muted)]">{labelFor(c)}</dt><dd className="mt-1 break-words text-sm">{summary(c)}{c.importance === "requirement" && <span className="ml-2 text-xs text-[var(--muted)]">Required</span>}</dd></div>)}</dl></details>}
    {questions.length > 0 && <details className="mt-4 border-t border-[var(--border)] pt-3">
      <summary className="cursor-pointer text-sm">Open questions ({questions.length})</summary>
      <ul className="mt-3 space-y-2">{questions.map(c => <li key={c.key} className="flex flex-wrap justify-between gap-2 text-sm"><span>{labelFor(c)}</span><span className="text-[var(--muted)]">{c.state === "unknown" ? "Not yet specified" : "Needs review"}</span></li>)}</ul>
      <button type="button" className={`${button} mt-3`} onClick={() => setEditing(true)}>Review open questions</button>
    </details>}
    {editing && <CriteriaDrawer initial={criteria} onClose={() => setEditing(false)} onApply={next => { onChange(next); setEditing(false); }} />}
  </section>;
}

function CriteriaDrawer({ initial, onClose, onApply }: { initial: Criterion[]; onClose: () => void; onApply: (criteria: Criterion[]) => void }) {
  const [draft, setDraft] = useState(initial);
  const dialog = useRef<HTMLDialogElement>(null);
  const backdropPressed = useRef(false);
  useEffect(() => {
    const element = dialog.current!;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element.showModal();
    return () => { element.close(); document.body.style.overflow = overflow; };
  }, []);
  const update = (key: Criterion["key"], patch: Partial<Criterion>) => setDraft(current => current.map(c => c.key === key ? { ...c, ...patch } : c));
  return createPortal(<dialog ref={dialog} onPointerDown={event => dialogBackdrop(backdropPressed, onClose).onPointerDown(event)} onPointerCancel={() => { backdropPressed.current = false; }} onClick={event => dialogBackdrop(backdropPressed, onClose).onClick(event)} aria-labelledby="criteria-drawer-title" onCancel={onClose} className="fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-dvh w-full max-w-2xl overflow-y-auto border-l border-[var(--border)] bg-[var(--panel)] p-0 text-[var(--foreground)] backdrop:bg-black/70">
    <header className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--panel)] p-5">
      <div className="flex items-center justify-between gap-4"><h2 id="criteria-drawer-title" className="text-xl font-semibold">Edit criteria</h2><button type="button" className={button} onClick={onClose}>Cancel</button></div>
      <p className="mt-2 text-sm text-[var(--muted)]">Set what you know and leave the rest unknown. Apply changes, then save the brief.</p>
    </header>
    <div className="space-y-5 p-5">{draft.map(c => <fieldset key={c.key} className="min-w-0 border-b border-[var(--border)] pb-5">
      <legend className="mb-2 text-sm font-medium">{labelFor(c)}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-[var(--muted)]">Answer<select aria-label={`${labelFor(c)} state`} className={field} value={c.state} onChange={e => update(c.key, { state: e.target.value as Criterion["state"], confirmed: false })}><option value="specified">Specified</option><option value="unknown">Unknown</option><option value="unrestricted">No restriction</option></select></label>
        <label className="text-xs text-[var(--muted)]">Importance<select aria-label={`${labelFor(c)} importance`} className={field} value={c.importance} onChange={e => update(c.key, { importance: e.target.value as Criterion["importance"], confirmed: false })}><option value="preference">Preference</option><option value="requirement">Requirement</option></select></label>
      </div>
      {c.state === "specified" && <div className="mt-3">{c.key === "geography" ? <GeographySelect className={field} value={c.value} onChange={value => update(c.key, { value, confirmed: false })} /> : <label className="block text-xs text-[var(--muted)]">Value<textarea aria-label={labelFor(c)} rows={c.key === "subsectors" ? 3 : 2} maxLength={1500} className={field} value={c.value} onChange={e => update(c.key, { value: e.target.value, confirmed: false })} /></label>}</div>}
    </fieldset>)}
      <details><summary className="cursor-pointer text-sm">Advanced details</summary>
        <div className="mt-3 space-y-4">{draft.map(c => <div key={c.key} className="grid items-center gap-2 sm:grid-cols-[1fr_130px_100px]"><span className="text-sm">{labelFor(c)}</span><label className="text-xs text-[var(--muted)]">Origin<select aria-label={`${labelFor(c)} origin`} className={field} value={c.origin} onChange={e => update(c.key, { origin: e.target.value as Criterion["origin"] })}><option value="supplied">Supplied</option><option value="inferred">Inferred</option><option value="assumed">Assumed</option></select></label><label className="flex items-center gap-2 text-xs"><input type="checkbox" aria-label={`${labelFor(c)} reviewed`} checked={c.confirmed} onChange={e => update(c.key, { confirmed: e.target.checked })} />Reviewed</label></div>)}</div>
      </details>
    </div>
    <footer className="sticky bottom-0 flex flex-wrap justify-end gap-2 border-t border-[var(--border)] bg-[var(--panel)] p-5">
      <button type="button" className={button} onClick={() => onApply(draft)}>Apply changes</button>
      <button type="button" className={`${button} bg-[var(--accent)] text-[var(--on-accent)]`} onClick={() => onApply(draft.map(c => ({ ...c, confirmed: true })))}>Mark all reviewed & apply</button>
    </footer>
  </dialog>, document.body);
}
