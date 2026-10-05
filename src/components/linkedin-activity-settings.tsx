"use client";
import { useState } from "react";

export type LinkedInSettings = {
  outreachPaused: boolean; timezone: string; activeDays: number[]; startHour: number; endHour: number;
  minSpacingSeconds: number; maxSpacingSeconds: number; invitationsDaily: number; invitationsWeekly: number;
  messagesDaily: number; profilesDaily: number; requestsDaily: number; requestsHourly: number;
  keepAliveEnabled: boolean; keepAliveMinMinutes: number; keepAliveMaxMinutes: number; keepAliveDays: number[];
};
export type LinkedInAction = { id: string; kind: string; recipient: string; text: string; status: string; reason?: string; nextEligibleAt?: number; approvedUntil?: number };
export type LinkedInDashboard = {
  settings: LinkedInSettings;
  usage: Record<string, { used: number; limit: number; resetAt?: number }>;
  protection: { status: string; reason?: string; nextEligibleAt?: number; cooldownUntil?: number; liveSendsEnabled: boolean };
  queue: LinkedInAction[];
  activity: { at: number; kind: string; status: string; detail: string }[];
  keepAlive: { enabled: boolean; lastRunAt?: number; nextRunAt?: number; status: string };
  cache: { fetchedAt?: number }; fixture: boolean;
};
export function linkedinTime(value?: number, timezone?: string) {
  return value ? new Date(value * 1000).toLocaleString(undefined, { timeZone: timezone }) : "—";
}
const numericFields: { key: keyof LinkedInSettings; label: string; min: number; max: number }[] = [
  { key: "invitationsDaily", label: "Invitations per 24 hours", min: 0, max: 30 },
  { key: "invitationsWeekly", label: "Invitations per 7 days", min: 0, max: 100 },
  { key: "messagesDaily", label: "Messages per 24 hours", min: 0, max: 100 },
  { key: "profilesDaily", label: "Profile reads per 24 hours", min: 0, max: 100 },
  { key: "requestsHourly", label: "Total requests per hour", min: 1, max: 60 },
  { key: "requestsDaily", label: "Total requests per 24 hours", min: 1, max: 500 },
];
const inputClass = "mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm";
const buttonClass = "rounded-md border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-50";
export function LinkedInActivitySettings({ data, busy, act }: {
  data: LinkedInDashboard; busy: boolean;
  act: (operation: string, body?: unknown, method?: string) => Promise<unknown>;
}) {
  const [changes, setChanges] = useState<Partial<LinkedInSettings>>({});
  const values = { ...data.settings, ...changes };
  const keepAliveDays = values.keepAliveDays ?? [0, 1, 2, 3, 4, 5, 6];
  const change = <K extends keyof LinkedInSettings>(key: K, value: LinkedInSettings[K]) => setChanges(previous => ({ ...previous, [key]: value }));
  const labels: Record<string, string> = { active: "Active", paused: "Outreach paused", cooling_down: "Cooling down", needs_verification: "Needs verification", scheduled: "Outside active hours" };
  const timezone = data.settings.timezone;
  return <div className="space-y-4 border-t border-[var(--border)] pt-4">
    <div className="rounded-lg border border-[var(--border)] p-3">
      <p className="font-medium">Account activity · {labels[data.protection.status] || data.protection.status}</p>
      {data.protection.reason && <p className="mt-1 text-sm text-[var(--muted)]">{data.protection.reason}</p>}
      <p className="mt-1 text-xs text-[var(--muted)]">Next eligible message: {linkedinTime(data.protection.nextEligibleAt, timezone)}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button className={buttonClass} disabled={busy} onClick={() => void act("settings", { outreachPaused: !data.settings.outreachPaused })}>{data.settings.outreachPaused ? "Resume outreach" : "Pause outreach"}</button>
        {data.protection.status === "needs_verification" && <button className={buttonClass} disabled={busy} onClick={() => void act("settings", { operation: "recover" })}>I completed verification</button>}
      </div>
      {!data.protection.liveSendsEnabled && !data.fixture && <p className="mt-2 text-xs text-[var(--muted)]">Live sending is disabled on this test instance. Settings and read-only feed activity can still be tested.</p>}
    </div>
    <details open>
      <summary className="cursor-pointer font-medium">Limits and schedule</summary>
      <form className="mt-3 space-y-4" onSubmit={async event => { event.preventDefault(); const saved = await act("settings", changes); if (saved) setChanges({}); }}>
        <p className="text-xs text-[var(--muted)]">Limits count attempted requests in the preceding hour, 24 hours, or 7 days. They are application limits, not guaranteed LinkedIn allowances. Zero disables that action.</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{numericFields.map(({ key, label, min, max }) => <label key={key} className="text-sm">{label}<input className={inputClass} type="number" required min={min} max={max} value={values[key] as number} onChange={e => change(key, e.target.valueAsNumber as never)} /><span className="mt-1 block text-xs text-[var(--muted)]">{data.usage[key]?.used || 0} of {data.usage[key]?.limit ?? values[key]} used</span></label>)}</div>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm">Timezone<input className={inputClass} required value={values.timezone} placeholder="Australia/Melbourne" onChange={e => change("timezone", e.target.value)} /></label>
          <label className="text-sm">Start hour (0–23)<input className={inputClass} type="number" required min={0} max={23} value={values.startHour} onChange={e => change("startHour", e.target.valueAsNumber)} /></label>
          <label className="text-sm">End hour (1–24)<input className={inputClass} type="number" required min={1} max={24} value={values.endHour} onChange={e => change("endHour", e.target.valueAsNumber)} /></label>
        </div>
        <fieldset><legend className="text-sm">Outreach days</legend><div className="mt-2 flex flex-wrap gap-4">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day, index) => <label key={day} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={values.activeDays.includes(index)} onChange={e => change("activeDays", e.target.checked ? [...values.activeDays, index] : values.activeDays.filter(d => d !== index))} />{day}</label>)}</div></fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">Minimum spacing (seconds)<input className={inputClass} type="number" required min={1} max={3600} value={values.minSpacingSeconds} onChange={e => change("minSpacingSeconds", e.target.valueAsNumber)} /></label>
          <label className="text-sm">Maximum spacing (seconds)<input className={inputClass} type="number" required min={1} max={7200} value={values.maxSpacingSeconds} onChange={e => change("maxSpacingSeconds", e.target.valueAsNumber)} /></label>
        </div>
        <fieldset className="space-y-3 rounded-lg border border-[var(--border)] p-3">
          <legend className="px-1 text-sm font-medium">Session keep-alive</legend>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={values.keepAliveEnabled} onChange={e => change("keepAliveEnabled", e.target.checked)} />Enable occasional read-only feed activity</label>
          <p className="text-xs text-[var(--muted)]">Visits the feed and scrolls at variable intervals on the selected keep-alive days, using the timezone and daytime hours above. Pausing outreach does not pause keep-alive. Waits while the live browser is open or approved actions are queued. Uses the overall request budget and stops on verification. Session expiry is still controlled by LinkedIn.</p>
          <fieldset><legend className="text-sm">Keep-alive days</legend><div className="mt-2 flex flex-wrap gap-4">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day, index) => <label key={day} className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label={`Keep-alive on ${day}`} checked={keepAliveDays.includes(index)} onChange={e => change("keepAliveDays", e.target.checked ? [...keepAliveDays, index] : keepAliveDays.filter(d => d !== index))} />{day}</label>)}</div></fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">Shortest interval (minutes)<input className={inputClass} type="number" required min={15} max={720} value={values.keepAliveMinMinutes} onChange={e => change("keepAliveMinMinutes", e.target.valueAsNumber)} /></label>
            <label className="text-sm">Longest interval (minutes)<input className={inputClass} type="number" required min={15} max={1440} value={values.keepAliveMaxMinutes} onChange={e => change("keepAliveMaxMinutes", e.target.valueAsNumber)} /></label>
          </div>
          <p className="text-xs text-[var(--muted)]">{data.keepAlive.status} · Last activity: {linkedinTime(data.keepAlive.lastRunAt, timezone)} · Next check: {linkedinTime(data.keepAlive.nextRunAt, timezone)}</p>
          <p className="text-xs text-[var(--muted)]">Keeps a browser worker running when enabled. Save and pause browser stops activity until you resume it.</p>
        </fieldset>
        <div className="flex gap-3"><button className={buttonClass} disabled={busy || !Object.keys(changes).length} type="submit">Save activity settings</button><button className={buttonClass} type="button" disabled={busy || !Object.keys(changes).length} onClick={() => setChanges({})}>Discard changes</button></div>
      </form>
    </details>
    <details open><summary className="cursor-pointer font-medium">Action queue</summary><div className="mt-3 space-y-2">
      {!data.queue.length && <p className="text-sm text-[var(--muted)]">No actions yet. Only approved drafts can be sent.</p>}
      {data.queue.map(action => <div key={action.id} className="rounded-lg border border-[var(--border)] p-3 text-sm">
        <div className="flex flex-wrap justify-between gap-2"><span>{action.kind === "invite" ? "Invitation" : "Message"} · {action.recipient}</span><span className="font-medium">{action.status}</span></div>
        <p className="mt-2 whitespace-pre-wrap">{action.text}</p>{action.reason && <p className="mt-2 text-xs text-[var(--muted)]">{action.reason}</p>}
        {action.status === "queued" && <p className="mt-1 text-xs text-[var(--muted)]">Eligible after: {linkedinTime(action.nextEligibleAt, timezone)} · Approval expires: {linkedinTime(action.approvedUntil, timezone)}</p>}
        {["draft", "queued"].includes(action.status) && <div className="mt-2 flex flex-wrap gap-2">
          {action.status === "draft" && <button className={buttonClass} disabled={busy || (!data.fixture && !data.protection.liveSendsEnabled)} onClick={() => void act("actions", { operation: "execute", id: action.id, approved: true })}>Approve exact draft and queue</button>}
          <button className={buttonClass} disabled={busy} onClick={() => void act("actions", { operation: "cancel", id: action.id })}>Cancel {action.status === "draft" ? "draft" : "queued action"}</button>
        </div>}
        {action.status === "uncertain" && <p className="mt-2 text-xs text-[var(--muted)]">Check the conversation in LinkedIn. This action will not be automatically retried.</p>}
        {["blocked", "expired"].includes(action.status) && <button className={`${buttonClass} mt-2`} disabled={busy} onClick={() => void act("actions", { kind: action.kind, recipient: action.recipient, text: action.text })}>Create a fresh draft for review</button>}
      </div>)}
    </div></details>
    <details><summary className="cursor-pointer font-medium">Recent activity</summary><ul className="mt-3 space-y-2 text-sm">{data.activity.length ? data.activity.map((entry, index) => <li key={`${entry.at}-${index}`}><span className="text-xs text-[var(--muted)]">{linkedinTime(entry.at, timezone)} · {entry.status}</span><p>{entry.detail}</p></li>) : <li className="text-[var(--muted)]">No activity recorded.</li>}</ul></details>
  </div>;
}
