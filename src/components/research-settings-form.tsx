"use client";

import { useState } from "react";

export function ResearchSettingsForm({ initialTarget }: { initialTarget: number }) {
  const [target, setTarget] = useState<number | "">(initialTarget);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const valid = Number.isInteger(target) && Number(target) >= 1 && Number(target) <= 100;
  async function save() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/settings/research", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ defaultTargetBusinesses: target }) });
      if (!response.ok) throw new Error((await response.json()).error || "Could not save research settings.");
      setMessage("Saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save research settings.");
    } finally { setBusy(false); }
  }
  return <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-6">
    <h2 className="text-lg font-semibold">Business research</h2>
    <p className="mt-2 text-sm text-[var(--muted)]">Set the number of new, distinct businesses to find in each research run.</p>
    <label className="mt-4 block max-w-xs text-sm">Default new businesses to find
      <input className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--panel-raised)] p-2" type="number" min="1" max="100" step="1" value={target} onChange={event => setTarget(event.target.value === "" ? "" : Number(event.target.value))} aria-invalid={!valid} />
    </label>
    <button className="mt-4 rounded-md border border-[var(--border)] px-4 py-2 disabled:opacity-40" disabled={!valid || busy} onClick={save}>{busy ? "Saving…" : "Save research default"}</button>
    {message && <p role="status" className="mt-2 text-sm">{message}</p>}
  </section>;
}
