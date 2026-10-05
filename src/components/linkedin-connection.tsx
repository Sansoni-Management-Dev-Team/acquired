"use client";
import { useEffect, useState } from "react";
import { LinkedInActivitySettings, linkedinTime, type LinkedInDashboard } from "@/components/linkedin-activity-settings";

type Connection = { status: string; saved?: boolean; fixture?: boolean; inboxCaptured?: boolean; agentConfigured?: boolean };
type Draft = { id: string; kind: string; recipient: string; text: string; status: string; providerId?: string };
const labels: Record<string, string> = { disconnected: "Not connected", login_required: "Complete login in the live browser", connected: "Connected", paused: "Session saved — browser paused", unavailable: "Connection service unavailable", browser_closed: "Browser closed" };

export function LinkedInConnection({ fixturesEnabled = false }: { fixturesEnabled?: boolean }) {
  const [connection, setConnection] = useState<Connection>({ status: "disconnected" });
  const [dashboard, setDashboard] = useState<LinkedInDashboard>();
  const [viewer, setViewer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<unknown>();
  const [recipient, setRecipient] = useState("");
  const [text, setText] = useState("");
  const [kind, setKind] = useState("message");
  const [draft, setDraft] = useState<Draft>();
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
      } catch { /* Keep the last known status while the service restarts. */ }
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
      else if (operation === "actions") setDraft(data.action);
      else { setResult(data); if (operation === "agent") setViewer(""); }
      if (operation !== "settings") {
        const updated = await fetch("/api/channels/linkedin?op=settings", { cache: "no-store" });
        if (updated.ok) setDashboard(await updated.json());
      }
      return data;
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Request failed"); }
    finally { setBusy(false); }
  }
  return <div className="space-y-3">
    <p role="status" className="text-sm">{labels[connection.status] || connection.status}{connection.fixture ? " · Fictional test account" : ""}</p>
    <div className="flex flex-wrap gap-2">
      <button disabled={busy} onClick={() => void act("connection", { fixture: false })} className="rounded-md border border-[var(--border)] px-3 py-2 text-sm">{connection.saved && !connection.fixture ? "Resume LinkedIn browser" : "Connect LinkedIn"}</button>
      {fixturesEnabled && connection.status !== "unavailable" && <button disabled={busy} onClick={() => void act("connection", { fixture: true })} className="rounded-md border border-[var(--border)] px-3 py-2 text-sm">Test with fictional account</button>}
      {["connected", "login_required"].includes(connection.status) && <button disabled={busy} onClick={() => void act("connection", { action: "pause" })} className="rounded-md border border-[var(--border)] px-3 py-2 text-sm">Save and pause browser</button>}
      {connection.saved && <button disabled={busy} onClick={() => void act("connection", undefined, "DELETE")} className="rounded-md border border-[var(--border)] px-3 py-2 text-sm">Disconnect and delete saved session</button>}
    </div>
    {viewer && <div className="space-y-2"><p className="text-sm text-[var(--muted)]">Enter your LinkedIn credentials in the live browser and complete any verification. Login remains under your control.</p>
      <iframe title="LinkedIn live browser" src={viewer} referrerPolicy="no-referrer" sandbox="allow-scripts allow-same-origin" className="h-[660px] w-full rounded-lg border border-[var(--border)]" />
      <div className="flex gap-4"><a href={viewer} target="_blank" rel="noopener noreferrer" className="text-sm underline">Open live browser in new tab</a><button className="text-sm underline" onClick={() => setViewer("")}>Hide live browser</button></div></div>}
    {(connection.status === "connected" || dashboard?.cache.fetchedAt) && <div className="space-y-3 border-t border-[var(--border)] pt-3">
      <div className="flex flex-wrap gap-2">
        <button disabled={busy} onClick={() => void act("inbox", undefined, "GET")} className="rounded border border-[var(--border)] px-3 py-2 text-sm">Read saved conversations</button>
        <button disabled={busy || connection.status !== "connected"} onClick={() => void act("inbox", {}, "POST")} className="rounded border border-[var(--border)] px-3 py-2 text-sm">Refresh from LinkedIn</button>
        <button disabled={busy || connection.status !== "connected" || !connection.agentConfigured} onClick={() => void act("agent", {})} className="rounded border border-[var(--border)] px-3 py-2 text-sm">Inspect page with Browser Use</button>
      </div>
      <p className="text-xs text-[var(--muted)]">Agent inspection is read-only and sends visible page content to the configured model provider. The viewer pauses during inspection. Open LinkedIn Messaging to capture the inbox request.</p>
      <p className="text-xs text-[var(--muted)]">Last inbox sync: {linkedinTime(dashboard?.cache.fetchedAt, dashboard?.settings.timezone)}</p>
      <details><summary className="cursor-pointer text-sm">Draft an invitation or message</summary><div className="mt-3 space-y-3">
        <p className="text-xs text-[var(--muted)]">Review the exact recipient and message before approval. Editing these fields creates a separate draft; cancel any previous queued draft first.</p>
        <label className="block text-sm">Action<select value={kind} onChange={e => { setKind(e.target.value); setDraft(undefined); }} className="ml-3 rounded border border-[var(--border)] bg-[var(--panel)] p-2"><option value="message">Direct message</option><option value="invite">Connection request</option></select></label>
        <label className="block text-sm">Recipient profile URN<input value={recipient} onChange={e => { setRecipient(e.target.value); setDraft(undefined); }} placeholder="urn:li:fsd_profile:fixture" className="mt-1 block w-full rounded border border-[var(--border)] bg-[var(--panel)] p-2" /></label>
        <label className="block text-sm">Exact message<textarea value={text} maxLength={kind === "invite" ? 200 : 4000} onChange={e => { setText(e.target.value); setDraft(undefined); }} className="mt-1 block w-full rounded border border-[var(--border)] bg-[var(--panel)] p-2" /></label>
        <button disabled={busy || !recipient} onClick={() => void act("actions", { kind, recipient, text })} className="rounded border border-[var(--border)] px-3 py-2 text-sm">Review draft</button>
        {draft && <div className="rounded border border-[var(--border)] p-3"><p className="text-sm">{draft.kind} to {draft.recipient}</p><p className="my-2 whitespace-pre-wrap text-sm">{draft.text}</p><p role="status" className="text-sm">Status: {draft.status}</p>
          {draft.status === "draft" && <button disabled={busy || (!connection.fixture && !dashboard?.protection.liveSendsEnabled)} onClick={() => void act("actions", { operation: "execute", id: draft.id, approved: true })} className="mt-2 rounded border border-[var(--border)] px-3 py-2 text-sm">Approve exact draft and queue</button>}</div>}
      </div></details>
    </div>}
    {dashboard && <LinkedInActivitySettings data={dashboard} busy={busy} act={act} />}
    {busy && <p role="status" className="text-sm">Working…</p>}
    {error && <p role="alert" className="text-sm text-[var(--status-red)]">{error}</p>}
    {result !== undefined && <InboxSummary result={result} />}
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
