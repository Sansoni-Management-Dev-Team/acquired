"use client";
import { useState } from "react";
import { CheckCircle2, CircleAlert, LoaderCircle, HeartPulse } from "lucide-react";
import type { ChannelHealth } from "@/lib/channel-health";

export function ChannelHealthButton({ provider }: { provider: "gmail" | "linkedin" | "whatsapp" }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ChannelHealth>();
  return <div className="space-y-2">
    <button type="button" aria-label={`Test ${provider === "gmail" ? "Gmail" : provider === "linkedin" ? "LinkedIn" : "WhatsApp"} connection`} disabled={busy} onClick={async () => {
      setBusy(true); setResult(undefined);
      try {
        const response = await fetch(`/api/channels/health?provider=${provider}`, { method: "POST", cache: "no-store", signal: AbortSignal.timeout(25000) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to check connection");
        setResult(data);
      } catch (error) { setResult({ status: "unavailable", message: error instanceof Error && error.name !== "TimeoutError" ? error.message : "Connection check timed out. Try again shortly.", checkedAt: new Date().toISOString() }); }
      finally { setBusy(false); }
    }} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md border border-[var(--border)] px-4 py-2 text-sm font-medium hover:bg-[var(--accent-soft)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--accent)] disabled:opacity-50">
      {busy ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <HeartPulse size={16} aria-hidden="true" />}{busy ? "Checking…" : "Test connection"}
    </button>
    {result && <p role="status" className={`flex items-start gap-2 text-sm ${result.status === "healthy" ? "text-[var(--status-emerald)]" : "text-[var(--status-amber)]"}`}>
      {result.status === "healthy" ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" aria-hidden="true" /> : <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />}<span>{result.message}<span className="mt-1 block text-xs text-[var(--muted)]">Checked at {new Date(result.checkedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span></span>
    </p>}
  </div>;
}
