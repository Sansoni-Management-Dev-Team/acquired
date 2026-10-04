import type { OutreachContactView } from "./outreach-queue";
import type { SavedResearchFinding } from "@/domain/research";

type ContactRow = { id: string; name: string; roles: string[]; emails: string[]; phone?: string; sources: string[]; status: string };
const normalise = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();
const unique = (values: string[]) => [...new Set(values.filter(Boolean))];

export function companyContactRows(contacts: OutreachContactView[], findings: SavedResearchFinding[]): ContactRow[] {
  const rows: ContactRow[] = contacts.map(contact => ({ id: contact.id, name: contact.displayName, roles: contact.role ? [contact.role] : [], emails: contact.email ? [contact.email] : [], phone: contact.phone, sources: contact.sourceUrl ? [contact.sourceUrl] : [], status: contact.doNotContact ? "Do not contact" : contact.fictionalised ? "Demo contact" : contact.emailStatus === "published-unverified" ? "Published · unverified" : "Saved contact" }));
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

export function CompanyContactsTable({ contacts, findings = [], loading = false, error, availablePeopleCount }: {
  contacts: OutreachContactView[]; findings?: SavedResearchFinding[]; loading?: boolean; error?: string; availablePeopleCount?: number;
}) {
  const rows = companyContactRows(contacts, findings);
  return <section aria-labelledby="company-contacts-heading" className="space-y-4">
    <div className="flex items-center justify-between gap-4"><h3 id="company-contacts-heading" className="text-lg font-semibold">Contacts</h3><span className="text-sm text-[var(--muted)]">{rows.length} {rows.length === 1 ? "person" : "people"}</span></div>
    {availablePeopleCount != null && <p className="text-sm text-[var(--muted)]">{availablePeopleCount} people profiles available · {rows.length} shown here</p>}
    {error && <p role="alert" className="text-sm text-[var(--status-red)]">{error}</p>}
    {loading && <p role="status" className="text-sm text-[var(--muted)]">Loading saved contacts…</p>}
    {rows.length ? <div className="overflow-x-auto rounded-[14px] border border-[var(--border)]"><table aria-label="Company contacts" className="w-full min-w-[620px] text-left text-sm">
      <thead className="bg-[var(--panel)] text-xs text-[var(--muted)]"><tr>{["Name & role", "Email", "Phone", "Source", "Status"].map(label => <th key={label} scope="col" className="px-4 py-3 font-medium">{label}</th>)}</tr></thead>
      <tbody className="divide-y divide-[var(--border)]">{rows.map(row => <tr key={row.id} className="[&_td]:align-top">
        <td className="min-w-44 px-4 py-4"><p className="font-medium">{row.name}</p>{row.roles.map(role => <p className="mt-1 text-xs text-[var(--muted)]" key={role}>{role}</p>)}</td>
        <td className="min-w-44 whitespace-nowrap px-4 py-4">{row.emails.length ? row.emails.map(email => <p key={email}>{email}</p>) : <Missing />}</td>
        <td className="whitespace-nowrap px-4 py-4">{row.phone || <Missing />}</td>
        <td className="px-4 py-4">{row.sources.length ? row.sources.map((source, index) => <Source key={source} url={source} index={index} />) : <Missing />}</td>
        <td className={`px-4 py-4 text-xs ${row.status === "Do not contact" ? "text-[var(--status-red)]" : "text-[var(--muted)]"}`}>{row.status}</td>
      </tr>)}</tbody>
    </table></div> : !loading && !error && <p className="rounded-[14px] bg-[var(--panel)] p-5 text-sm text-[var(--muted)]">{availablePeopleCount === 0 ? "No people profiles available for this company." : availablePeopleCount ? "People profiles are available. Contact retrieval has not finished." : "No contacts found yet."}</p>}
  </section>;
}
function Missing() { return <span aria-label="Not found" className="text-[var(--muted)]">—</span>; }
function Source({ url, index }: { url: string; index: number }) {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  if (!["https:", "http:"].includes(parsed.protocol)) return null;
  return <a href={url} target="_blank" rel="noreferrer" className="block min-h-12 content-center text-xs underline underline-offset-4">{parsed.hostname.replace(/^www\./, "")}{index > 0 ? ` (${index + 1})` : ""}</a>;
}
