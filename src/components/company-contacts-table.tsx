import { LoaderCircle, Users } from "lucide-react";
import type { OutreachContactView } from "./outreach-queue";
import type { SavedResearchFinding } from "@/domain/research";

type ContactRow = { id: string; name: string; roles: string[]; emails: string[]; phone?: string; emailReason?: string; phoneReason?: string; sources: string[]; status: string };
const normalise = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();
const unique = (values: string[]) => [...new Set(values.filter(Boolean))];

export function companyContactRows(contacts: OutreachContactView[], findings: SavedResearchFinding[]): ContactRow[] {
  const rows: ContactRow[] = contacts.map(contact => ({ id: contact.id, name: contact.displayName, roles: contact.role ? [contact.role] : [], emails: contact.email ? [contact.email] : [], phone: contact.phone, emailReason: contact.completeness?.email.reason, phoneReason: contact.completeness?.phone.reason, sources: contact.sourceUrl ? [contact.sourceUrl] : [], status: contact.doNotContact ? "Do not contact" : contact.fictionalised ? "Demo contact" : contact.emailStatus === "published-unverified" ? "Published · unverified" : "Saved contact" }));
  for (const finding of findings.filter(f => f.evidence.kind === "person")) {
    const { name, value: role, email } = finding.evidence;
    const row = rows.find(r => normalise(r.name) === normalise(name) && (!email || !r.emails.length || r.emails.some(existing => normalise(existing) === normalise(email))));
    if (row) {
      row.roles = unique([...row.roles, role]);
      row.emails = unique([...row.emails, ...(email ? [email] : [])]);
      row.sources = unique([...row.sources, finding.sourceUrl]);
    } else rows.push({ id: finding.id, name, roles: [role], emails: email ? [email] : [], sources: [finding.sourceUrl], status: "Research lead · unverified" });
  }
  return rows;
}

export type ContactRetrievalRun = { id: string; status: string; searchStatus?: string; profilesSaved?: number; profilesFound?: number };

export function CompanyContactsTable({ contacts, findings = [], loading = false, error, availablePeopleCount, run, starting = false, onLoadPeople, onRetry }: {
  contacts: OutreachContactView[]; findings?: SavedResearchFinding[]; loading?: boolean; error?: string; availablePeopleCount?: number;
  run?: ContactRetrievalRun; starting?: boolean; onLoadPeople?: () => void; onRetry?: () => void;
}) {
  const rows = companyContactRows(contacts, findings);
  const active = starting || ["queued", "running"].includes(run?.status || "");
  const incomplete = run?.status === "failed" || run?.status === "partial";
  const complete = run?.status === "complete";
  const title = loading ? "Checking for people…" : active ? run?.status === "running" ? "Loading people…" : "Getting ready to load people…"
    : incomplete ? rows.length ? "Some people couldn’t be loaded" : "People couldn’t be loaded" : complete && !rows.length && availablePeopleCount !== 0 ? "No people could be loaded"
    : rows.length ? `${rows.length} ${rows.length === 1 ? "person" : "people"} loaded`
    : availablePeopleCount ? `${availablePeopleCount} ${availablePeopleCount === 1 ? "person" : "people"} ready to load`
    : availablePeopleCount === 0 ? "No profiles available" : "Find people at this company";
  const detail = loading ? "Your contacts will appear here." : active ? `${run?.profilesSaved || 0} saved so far. This list updates automatically. You can close this panel.`
    : incomplete || complete && !rows.length && availablePeopleCount !== 0 ? "Try again to load people. Any saved contacts are kept."
    : rows.length ? "Names and contact details are listed below."
    : availablePeopleCount === 0 ? "The company directory has no people profiles for this company."
    : "Load names, roles and available contact details.";
  const canLoad = !loading && !active && (!complete || !rows.length) && (incomplete || availablePeopleCount !== 0);
  const actionClass = "inline-flex min-h-12 items-center justify-center rounded-[10px] bg-[var(--accent)] px-5 text-sm font-semibold text-[var(--on-accent)] hover:bg-[var(--accent-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]";
  return <section aria-labelledby="company-contacts-heading" className="space-y-5">
    <h3 id="company-contacts-heading" className="text-lg font-semibold">Contacts</h3>
    <div className="rounded-[14px] border border-[var(--border)] bg-[var(--panel)] p-5">
      <div className="flex items-start gap-3">
        {loading || active ? <LoaderCircle aria-hidden="true" size={22} className="mt-0.5 shrink-0 animate-spin text-[var(--accent)] motion-reduce:animate-none" /> : <Users aria-hidden="true" size={22} className="mt-0.5 shrink-0 text-[var(--muted)]" />}
        <div className="min-w-0 space-y-2">
          <p role="status" aria-live="polite" className="text-base font-semibold">{title}</p>
          <p className="text-sm leading-6 text-[var(--muted)]">{detail}</p>
          {error && <p role="alert" className="text-sm leading-6 text-[var(--status-red)]">{error}</p>}
          {error && onRetry ? <button type="button" className={`${actionClass} mt-2`} onClick={onRetry}>Try again</button>
            : canLoad && onLoadPeople ? <button type="button" className={`${actionClass} mt-2`} onClick={onLoadPeople}>{incomplete || complete ? "Try again" : rows.length ? "Load more people" : "Load people"}</button> : null}
        </div>
      </div>
    </div>
    {rows.length ? <div className="overflow-x-auto rounded-[14px] border border-[var(--border)]"><table aria-label="Company contacts" className="w-full min-w-[620px] text-left text-sm">
      <thead className="bg-[var(--panel)] text-xs text-[var(--muted)]"><tr>{["Name & role", "Email", "Phone", "Source", "Status"].map(label => <th key={label} scope="col" className="px-4 py-3 font-medium">{label}</th>)}</tr></thead>
      <tbody className="divide-y divide-[var(--border)]">{rows.map(row => <tr key={row.id} className="[&_td]:align-top">
        <td className="min-w-44 px-4 py-4"><p className="font-medium">{row.name}</p>{row.roles.map(role => <p className="mt-1 text-xs text-[var(--muted)]" key={role}>{role}</p>)}</td>
        <td className="min-w-44 whitespace-nowrap px-4 py-4">{row.emails.length ? row.emails.map(email => <p key={email}>{email}</p>) : <Missing reason={row.emailReason} />}</td>
        <td className="whitespace-nowrap px-4 py-4">{row.phone || <Missing reason={row.phoneReason} />}</td>
        <td className="px-4 py-4">{row.sources.length ? row.sources.map((source, index) => <Source key={source} url={source} index={index} />) : <Missing />}</td>
        <td className={`px-4 py-4 text-xs ${row.status === "Do not contact" ? "text-[var(--status-red)]" : "text-[var(--muted)]"}`}>{row.status}</td>
      </tr>)}</tbody>
    </table></div> : null}
  </section>;
}
function Missing({ reason }: { reason?: string }) { return <span aria-label={reason || "Not found"} className="text-xs text-[var(--muted)]">{reason || "—"}</span>; }
function Source({ url, index }: { url: string; index: number }) {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  if (!["https:", "http:"].includes(parsed.protocol)) return null;
  return <a href={url} target="_blank" rel="noreferrer" className="block min-h-12 content-center text-xs underline underline-offset-4">{parsed.hostname.replace(/^www\./, "")}{index > 0 ? ` (${index + 1})` : ""}</a>;
}
