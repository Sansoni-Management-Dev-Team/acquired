import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireDb } from "@/db/client";
import { OrganizationRepository } from "@/db/repositories";
import { auth } from "@/lib/auth";
import { providerNeutralText } from "@/domain/provider-display";

export default async function AuditPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in?next=/audit");
  const organizationId = session.session.activeOrganizationId;
  if (!organizationId) redirect("/onboarding");
  const events = await new OrganizationRepository(requireDb(), organizationId).listAudit(100);
  return <div className="p-6 md:p-8"><p className="text-xs uppercase tracking-[.18em] text-[var(--accent)]">Traceability</p><h1 className="mt-2 text-3xl font-semibold">Audit trail</h1><p className="mb-7 mt-3 max-w-2xl text-[var(--muted)]">Persisted provider, enrichment, contact, and outreach decisions for this organisation.</p><div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]">{events.map((event) => <article key={event.id} className="grid gap-3 border-b border-[var(--border)] p-5 last:border-0 md:grid-cols-[180px_190px_1fr]"><time className="text-xs text-[var(--muted)]">{event.createdAt.toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short", timeZone: "Australia/Melbourne" })}</time><div><span className="rounded bg-[var(--accent-soft)] px-2 py-1 font-mono text-[11px] text-[var(--accent)]">{providerNeutralText(event.action)}</span><p className="mt-2 text-xs text-[var(--muted)]">{event.entityType}</p></div><div><h2 className="text-sm font-semibold">{event.entityId}</h2><pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs leading-5 text-[var(--muted)]">{providerNeutralText(JSON.stringify(event.metadata, null, 2))}</pre></div></article>)}{events.length === 0 && <p className="p-8 text-sm text-[var(--muted)]">No persisted audit events yet.</p>}</div></div>;
}
