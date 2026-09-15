import { mandateOutreachHref } from "@/domain/mandate-navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { permanentRedirect, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AcquisitionRepository } from "@/db/acquisition-repository";
import { MandateNavigation } from "@/components/mandate-workspace";

export default async function OutreachPage({ searchParams }: { searchParams: Promise<{ mandateId?: string; targetId?: string }> }) {
  const { mandateId, targetId } = await searchParams;
  if (mandateId) permanentRedirect(mandateOutreachHref(mandateId, targetId));
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in?next=/outreach");
  const organizationId = session.session.activeOrganizationId;
  if (!organizationId) redirect("/onboarding");
  const acquisition = new AcquisitionRepository(organizationId);
  const mandates = await acquisition.listMandates();
  if (!mandateId) {
    return <div className="p-6 md:p-8">
      <MandateNavigation mandates={mandates} tab="outreach" /><h1 className="text-3xl font-semibold">Outreach</h1>
      <p className="mt-3 text-[var(--muted)]">Choose a mandate to review its contacts and outreach drafts.</p>
      <div className="mt-7 grid gap-4 md:grid-cols-2">
        {mandates.map(m => <Link key={m.id} href={mandateOutreachHref(m.id)} className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5 hover:bg-[var(--panel-raised)]">
          <h2 className="font-semibold">{m.brief.name}</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">Open outreach</p>
        </Link>)}
      </div>
      {!mandates.length && <p className="mt-6 text-[var(--muted)]">Create a mandate to start organising outreach. <Link href="/mandates/new" className="text-[var(--accent)] underline">Create a mandate</Link></p>}
    </div>;
  }
}
