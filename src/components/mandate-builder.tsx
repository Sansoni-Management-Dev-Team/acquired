"use client";

import { useState } from "react";
import { mandateConfirmation, parseMandate } from "@/domain/mandate";
import type { Mandate } from "@/domain/models";

const initial = "Find mechanical services and industrial maintenance businesses in VIC, NSW and QLD with revenue $10m to $50m and EBITDA $1m to $5m, headcount 20-180";

export function MandateBuilder() {
  const [text, setText] = useState(initial);
  const [mandate, setMandate] = useState<Mandate>(() => parseMandate(initial));
  const [error, setError] = useState("");
  function parse() {
    try { setMandate(parseMandate(text)); setError(""); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not parse mandate"); }
  }
  const format = (value: number) => `$${value / 1_000_000}m`;
  return <div className="grid gap-6 xl:grid-cols-[1.2fr_.8fr]">
    <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-6">
      <label htmlFor="mandate" className="text-sm font-medium">Describe the acquisition mandate</label>
      <textarea id="mandate" value={text} onChange={(event) => setText(event.target.value)} className="mt-3 min-h-44 w-full resize-y rounded-lg border border-[var(--border)] bg-black/20 p-4 leading-7 outline-none focus:border-[var(--accent)]" />
      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
      <button onClick={parse} className="mt-4 rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-black">Parse mandate</button>
      <p className="mt-3 text-xs text-[var(--muted)]">Deterministic local parser. No mandate text leaves this environment.</p>
    </section>
    <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-6">
      <p className="text-xs uppercase tracking-[.16em] text-[var(--accent)]">Structured confirmation</p>
      <p className="mt-3 text-lg leading-7">{mandateConfirmation(mandate)}</p>
      <dl className="mt-6 grid grid-cols-2 gap-4 text-sm">
        <div><dt className="text-[var(--muted)]">Revenue</dt><dd>{format(mandate.revenue.min)}–{format(mandate.revenue.max)}</dd></div>
        <div><dt className="text-[var(--muted)]">EBITDA</dt><dd>{format(mandate.ebitda.min)}–{format(mandate.ebitda.max)}</dd></div>
        <div><dt className="text-[var(--muted)]">States</dt><dd>{mandate.states.join(", ")}</dd></div>
        <div><dt className="text-[var(--muted)]">Headcount</dt><dd>{mandate.headcount ? `${mandate.headcount.min}–${mandate.headcount.max}` : "Not specified"}</dd></div>
      </dl>
      <p className="mt-6 rounded-md border border-amber-400/20 bg-amber-400/5 p-3 text-xs text-amber-100">Saving remains unavailable until the initial database migration is reviewed and approved.</p>
    </section>
  </div>;
}
