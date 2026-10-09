"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import type { CampaignReplyAlert } from "@/domain/campaign-reply-alerts";
import { replyChannelLabel } from "@/domain/campaign-replies";

export function CampaignReplyAlertList({ alerts, onDismiss }: { alerts: CampaignReplyAlert[]; onDismiss: (id: string) => void }) {
  if (!alerts.length) return null;
  return <section role="status" aria-live="polite" aria-label="Reply alerts" className="mx-5 mt-5 rounded-xl border border-[var(--status-amber)] bg-[var(--panel)] p-4 sm:mx-8">
    <p className="flex items-center gap-2 text-sm font-semibold"><Bell size={17} /> Replies need your attention</p>
    <ul className="mt-3 space-y-3">{alerts.map(alert => <li key={alert.id} className="flex items-start justify-between gap-3 text-sm">
      <div><p><strong>{alert.contactName}</strong> · {replyChannelLabel(alert.channel)} {alert.needsReview ? "reply identity needs review" : "reply received"}</p>
        <p className="mt-1 text-xs text-[var(--muted)]">{new Date(alert.receivedAt).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })} · {alert.needsReview ? "Outreach held across all channels." : "All further outreach stopped."}</p>
        <Link href={`/mandates/${alert.mandateId}/people`} className="mt-1 inline-block underline underline-offset-2">View person and outreach</Link></div>
      <button type="button" onClick={() => onDismiss(alert.id)} aria-label={`Dismiss reply alert for ${alert.contactName}`} className="flex size-10 shrink-0 items-center justify-center rounded-lg hover:bg-[var(--panel-raised)]"><X size={16} /></button>
    </li>)}</ul>
  </section>;
}

export function CampaignReplyAlerts() {
  const [alerts, setAlerts] = useState<CampaignReplyAlert[]>([]);
  const [scope, setScope] = useState("");
  const [dismissed, setDismissed] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false, inFlight = false;
    const refresh = async () => {
      if (inFlight || document.hidden) return;
      inFlight = true;
      try {
        const response = await fetch("/api/campaigns/reply-alerts", { cache: "no-store" });
        if (cancelled) return;
        if (response.status === 401) { setAlerts([]); setScope(""); setDismissed([]); return; }
        if (!response.ok) return;
        const next = await response.json() as { scope: string; alerts: CampaignReplyAlert[] };
        if (cancelled) return;
        let saved: string[] = [];
        try {
          const stored: unknown = JSON.parse(localStorage.getItem(`acquired-reply-alerts:${next.scope}`) || "[]");
          if (Array.isArray(stored)) saved = stored.filter((id): id is string => typeof id === "string");
        } catch { /* Alerts still work when browser storage is unavailable. */ }
        setScope(next.scope); setDismissed(saved); setAlerts(next.alerts);
      } catch { /* Keep the last known alerts during a temporary outage. */ }
      finally { inFlight = false; }
    };
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 30000);
    const onVisible = () => { void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { cancelled = true; clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, []);
  function dismiss(id: string) {
    const next = [...dismissed, id].slice(-200);
    setDismissed(next);
    try { localStorage.setItem(`acquired-reply-alerts:${scope}`, JSON.stringify(next)); } catch { /* Dismiss in this session. */ }
  }
  return <CampaignReplyAlertList alerts={alerts.filter(alert => !dismissed.includes(alert.id))} onDismiss={dismiss} />;
}
