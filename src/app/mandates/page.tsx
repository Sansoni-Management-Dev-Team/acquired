import Link from "next/link";
import { AcquisitionRepository } from "@/db/acquisition-repository";
import { acquisitionSession } from "@/lib/acquisition-session";
export default async function MandatesPage() {
  const { organizationId } = await acquisitionSession();
  const mandates = await new AcquisitionRepository(organizationId).listMandates();
  return <div className="space-y-6 p-5 sm:p-8"><h1 className="text-3xl font-semibold">Acquisition mandates</h1><p className="text-[var(--muted)]">Keep each acquisition brief, target universe and pipeline separate.</p><Link className="inline-block rounded bg-[var(--accent)] px-4 py-2 text-black" href="/mandates/new">Create a mandate</Link><div className="grid gap-4 md:grid-cols-2">{mandates.map(m => <Link key={m.id} className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 hover:border-[var(--accent)]" href={`/mandates/${m.id}`}><h2 className="text-lg font-semibold">{m.brief.name}</h2><p className="mt-3 text-sm text-[var(--muted)]">{m.brief.criteria.filter(c => c.state === "unknown").length} unanswered criteria · Open workspace</p></Link>)}</div>{!mandates.length && <p className="text-sm text-[var(--muted)]">Create your first mandate to review a brief and build its target universe.</p>}</div>;
}
