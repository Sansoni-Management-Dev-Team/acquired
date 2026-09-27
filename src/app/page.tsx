import Link from "next/link";
import { eq } from "drizzle-orm";
import { AcquisitionRepository } from "@/db/acquisition-repository";
import { requireDb } from "@/db/client";
import { organization } from "@/db/schema";
import { acquisitionSession } from "@/lib/acquisition-session";
import { buyerProfileFromMetadata } from "@/domain/buyer-profile";
import { BuyerProfileEditor } from "@/components/buyer-profile-editor";
import { MandateNavigation } from "@/components/mandate-workspace";

export default async function Home() {
  const { organizationId } = await acquisitionSession();
  const [mandates, organizations] = await Promise.all([
    new AcquisitionRepository(organizationId).listMandates(),
    requireDb().select({ metadata: organization.metadata }).from(organization).where(eq(organization.id, organizationId)),
  ]);
  const buyerProfile = buyerProfileFromMetadata(organizations[0]?.metadata);

  return <div className="space-y-6 p-5 sm:p-8">
    <MandateNavigation mandates={mandates} />
    <header><p className="text-xs uppercase tracking-widest text-[var(--accent)]">Acquisition workspace</p><h1 className="mt-2 text-3xl font-semibold">Home</h1></header>
    <BuyerProfileEditor initial={buyerProfile} />
    <section className="space-y-4" aria-labelledby="mandates-heading">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="mandates-heading" className="text-xl font-semibold">Mandates</h2><Link className="rounded-md border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--panel-raised)]" href="/mandates/new">Create a mandate</Link></div>
      {mandates.length ? <div className="grid gap-4 md:grid-cols-2">{mandates.map(mandate => <Link key={mandate.id} className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 hover:border-[var(--accent)]" href={`/mandates/${mandate.id}`}><h3 className="font-semibold">{mandate.brief.name}</h3><p className="mt-2 text-sm text-[var(--muted)]">Open brief and find businesses</p></Link>)}</div> : <p className="text-sm text-[var(--muted)]">Create a mandate to start finding businesses.</p>}
    </section>
  </div>;
}
