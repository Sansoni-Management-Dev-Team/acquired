"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AcquisitionBrief } from "@/domain/acquisition";

async function postJson(url: string, body: unknown, timeoutMs: number) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const result = await response.json() as { error?: string };
  if (!response.ok && !(response.status === 409 && result.error?.includes("already running"))) throw new Error(result.error || "Could not start company research.");
}

export function MandateBriefForm({ mandateId, brief }: { mandateId: string; brief: AcquisitionBrief }) {
  const router = useRouter();
  const [description, setDescription] = useState(brief.naturalLanguage);
  const [savedDescription, setSavedDescription] = useState(brief.naturalLanguage);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");

  async function findCompanies() {
    setBusy(true);
    setError("");
    try {
      if (description.trim() !== savedDescription) {
        setProgress("Updating your search…");
        await postJson(`/api/mandates/${mandateId}`, { action: "brief-description", description }, 40000);
        setSavedDescription(description.trim());
      }
      setProgress("Starting company research…");
      await postJson(`/api/mandates/${mandateId}/research`, { requestId: crypto.randomUUID(), fromBrief: true }, 30000);
      router.push(`/mandates/${mandateId}?tab=targets`);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error && cause.name === "TimeoutError" ? "This is taking longer than expected. Please try again." : cause instanceof Error ? cause.message : "Could not start company research.");
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  return <form onSubmit={event => { event.preventDefault(); void findCompanies(); }} className="mx-auto max-w-4xl space-y-5 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 sm:p-8">
    <label htmlFor="acquisition-description" className="block text-sm font-semibold">Describe the acquisition brief</label>
    <textarea id="acquisition-description" required minLength={10} maxLength={10000} rows={10} readOnly={busy} value={description} onChange={event => setDescription(event.target.value)} placeholder="Tell us about the businesses you’re looking to buy" className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--panel-raised)] p-4 text-sm text-[var(--foreground)]" />
    {error && <p role="alert" className="text-sm text-[var(--status-red)]">{error}</p>}
    {progress && <p role="status" className="text-sm text-[var(--muted)]">{progress}</p>}
    <div className="flex justify-end"><button disabled={busy || description.trim().length < 10} className="min-h-12 rounded-lg bg-[var(--accent)] px-5 text-sm font-semibold text-[var(--on-accent)] disabled:opacity-50">{busy ? "Finding companies…" : "Find companies"}</button></div>
  </form>;
}
