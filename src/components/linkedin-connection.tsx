"use client";
import { useEffect, useState } from "react";
import { ChannelHealthButton } from "@/components/channel-health-button";
import { LinkedInDisclosure } from "@/components/linkedin-disclosure";
import { LinkedInActivitySettings, linkedinTime, type LinkedInDashboard } from "@/components/linkedin-activity-settings";

type Connection = { status: string; saved?: boolean; fixture?: boolean; inboxCaptured?: boolean; agentConfigured?: boolean };
const labels: Record<string, string> = { checking: "Checking connection…", disconnected: "Not connected", login_required: "Complete login in the live browser", connected: "Connected", paused: "Session saved — browser paused", unavailable: "Connection service unavailable", browser_closed: "Browser closed" };

export function LinkedInConnection({ fixturesEnabled = false }: { fixturesEnabled?: boolean }) {
  const [connection, setConnection] = useState<Connection>({ status: "checking" });
  const [dashboard, setDashboard] = useState<LinkedInDashboard>();
  const [viewer, setViewer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<unknown>();
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const [response, settingsResponse] = await Promise.all([
          fetch("/api/channels/linkedin", { signal: controller.signal, cache: "no-store" }),
          fetch("/api/channels/linkedin?op=settings", { signal: controller.signal, cache: "no-store" }),
        ]);
        const data = await response.json();
        const settingsData = await settingsResponse.json();
        if (!controller.signal.aborted) {
          setConnection(response.ok ? data : { status: "unavailable" });
          if (settingsResponse.ok) setDashboard(settingsData);
        }
      } catch { if (!controller.signal.aborted) setConnection({ status: "unavailable" }); }
      if (!controller.signal.aborted) timer = setTimeout(poll, 5000);
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, []);
  async function act(operation: string, body?: unknown, method = "POST") {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/channels/linkedin?op=${operation}`, { method, ...(body ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "LinkedIn operation failed");
      if (operation === "connection") {
        setConnection(data); setViewer(data.viewerUrl || "");
      } else if (operation === "settings") setDashboard(data);
      else if (operation !== "actions") { setResult(data); if (operation === "agent") setViewer(""); }
      if (operation !== "settings") {
        const updated = await fetch("/api/channels/linkedin?op=settings", { cache: "no-store" });
        if (updated.ok) setDashboard(await updated.json());
      }
      return data;
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Request failed"); }
    finally { setBusy(false); }
  }
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <p role="status" className={`flex items-center gap-2 text-sm font-medium ${connection.status === "connected" ? "text-[var(--status-emerald)]" : ""}`}><span aria-hidden="true" className={`size-2 rounded-full ${connection.status === "connected" ? "bg-[var(--status-emerald)]" : "bg-[var(--muted)]"}`} />{labels[connection.status] || connection.status}{connection.fixture ? " · Fictional test account" : ""}</p>
      {dashboard?.cache.fetchedAt && <p className="text-xs text-[var(--muted)]">Last synced {linkedinTime(dashboard.cache.fetchedAt, dashboard.settings.timezone)}</p>}
    </div>
    <div className="flex flex-wrap items-start gap-3">
      <button disabled={busy || connection.status === "checking"} onClick={() => void act("connection", { fixture: false })} className="inline-flex min-h-12 items-center justify-center rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--on-accent)] hover:bg-[var(--accent-hover)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--accent)] disabled:opacity-50">{connection.saved && !connection.fixture ? "Open browser" : "Connect LinkedIn"}</button>
      <ChannelHealthButton provider="linkedin" />
    </div>
    {viewer && <div className="space-y-2"><p className="text-sm text-[var(--muted)]">Enter your LinkedIn credentials in the live browser and complete any verification. Login remains under your control.</p>
      <iframe title="LinkedIn live browser" src={viewer} referrerPolicy="no-referrer" sandbox="allow-scripts allow-same-origin" className="h-[660px] w-full rounded-lg border border-[var(--border)]" />
      <div className="flex gap-4"><a href={viewer} target="_blank" rel="noopener noreferrer" className="text-sm underline">Open live browser in new tab</a><button className="text-sm underline" onClick={() => setViewer("")}>Hide live browser</button></div></div>}
    {dashboard && <LinkedInActivitySettings data={dashboard} busy={busy} act={act} />}
    {(connection.status === "connected" || dashboard?.cache.fetchedAt) && <LinkedInDisclosure title="Connection diagnostics" hint="Sync and troubleshooting">
      <p className="mb-3 text-sm text-[var(--muted)]">Check saved conversations or refresh the inbox without sending a message.</p>
      <div className="flex flex-wrap gap-2">
        <button disabled={busy} onClick={() => void act("inbox", undefined, "GET")} className="min-h-12 rounded-md border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-50">Read saved conversations</button>
        <button disabled={busy || connection.status !== "connected"} onClick={() => void act("inbox", {}, "POST")} className="min-h-12 rounded-md border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-50">Refresh from LinkedIn</button>
        {connection.agentConfigured && <button disabled={busy || connection.status !== "connected"} onClick={() => void act("agent", {})} className="min-h-12 rounded-md border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-50">Inspect browser</button>}
      </div>
      {connection.agentConfigured && <p className="mt-3 text-xs text-[var(--muted)]">Browser inspection shares visible page content with the configured AI provider. It is read-only.</p>}
      {result !== undefined && <div className="mt-3"><InboxSummary result={result} /></div>}
    </LinkedInDisclosure>}
    {(connection.saved || fixturesEnabled) && <LinkedInDisclosure title="Manage session">
      <p className="mb-3 text-sm text-[var(--muted)]">Pausing saves your session and stops browser activity until you reopen it. Disconnecting removes your saved session.</p>
      <div className="flex flex-wrap gap-2">
        {["connected", "login_required"].includes(connection.status) && <button disabled={busy} onClick={() => void act("connection", { action: "pause" })} className="min-h-12 rounded-md border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-50">Save and pause browser</button>}
        {connection.saved && <button disabled={busy} onClick={() => void act("connection", undefined, "DELETE")} className="min-h-12 rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--status-red)] disabled:opacity-50">Disconnect LinkedIn</button>}
        {fixturesEnabled && <button disabled={busy} onClick={() => void act("connection", { fixture: true })} className="min-h-12 rounded-md border border-[var(--border)] px-3 py-2 text-sm">Test with fictional account</button>}
      </div>
    </LinkedInDisclosure>}
    {busy && <p role="status" className="text-sm">Working…</p>}
    {error && <p role="alert" className="text-sm text-[var(--status-red)]">{error}</p>}
  </div>;
}

function InboxSummary({ result }: { result: unknown }) {
  const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};
  const data = record(result);
  if (data.status === "complete") return <p className="text-sm">Read-only page inspection completed.</p>;
  const response = record(data.response);
  const body = record(response.data);
  const normalized = record(record(record(body.data).data).messengerConversationsBySyncToken);
  const conversations = body.conversations || normalized["*elements"];
  const count = Array.isArray(conversations) ? conversations.length : undefined;
  const cache = record(data.cache);
  return <div role="status" className="rounded-lg border border-[var(--border)] p-3 text-sm">
    <p>{count !== undefined ? `${count} conversations available` : typeof data.error === "string" ? data.error : "Inbox request completed"}</p>
    <p className="mt-1 text-xs text-[var(--muted)]">{cache.cached ? "Saved inbox" : "Retrieved from LinkedIn"}{cache.stale ? " · May be out of date" : ""}</p>
  </div>;
}
