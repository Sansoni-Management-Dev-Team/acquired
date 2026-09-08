import { MandateTabs } from "@/components/mandate-tabs";
import { loadOutreach } from "@/db/outreach-view";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { OutreachQueue } from "@/components/outreach-queue";
import { auth } from "@/lib/auth";
import { AcquisitionRepository } from "@/db/acquisition-repository";
import { MandateNavigation } from "@/components/mandate-workspace";

export default async function OutreachPage({ searchParams }: { searchParams: Promise<{ mandateId?: string; targetId?: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in?next=/outreach");
  const organizationId = session.session.activeOrganizationId;
  if (!organizationId) redirect("/onboarding");
  const { mandateId, targetId } = await searchParams;
  const acquisition = new AcquisitionRepository(organizationId);
  const mandates = await acquisition.listMandates();
  if (!mandateId) {
    return <div className="p-6 md:p-8">
      <MandateNavigation mandates={mandates} tab="outreach" /><h1 className="text-3xl font-semibold">Outreach</h1>
      <p className="mt-3 text-[var(--muted)]">Choose a mandate to review its contacts and outreach drafts.</p>
      <div className="mt-7 grid gap-4 md:grid-cols-2">
        {mandates.map(m => <Link key={m.id} href={`/outreach?mandateId=${m.id}`} className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5 hover:bg-[var(--panel-raised)]">
          <h2 className="font-semibold">{m.brief.name}</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">Open outreach</p>
        </Link>)}
      </div>
      {!mandates.length && <p className="mt-6 text-[var(--muted)]">Create a mandate to start organising outreach. <Link href="/mandates/new" className="text-[var(--accent)] underline">Create a mandate</Link></p>}
    </div>;
  }
  const mandate = mandates.find(m => m.id === mandateId);
  if (!mandate) notFound();
  const { views, buyerProfile } = await loadOutreach(organizationId, mandateId);
  return <><MandateNavigation mandates={mandates} selected={mandateId} tab="outreach" /><div className="p-6 md:p-8"><p className="text-xs uppercase tracking-[.18em] text-[var(--accent)]">Human gate</p><h1 className="mt-2 text-3xl font-semibold">{mandate.brief.name}</h1><h2 className="mt-4 text-xl font-semibold">Outreach</h2><p className="mb-7 mt-3 max-w-2xl text-[var(--muted)]">Saved company evidence becomes outreach only after a decision-maker is selected. Approval saves the message to Gmail Drafts for review; live delivery remains off.</p><div className="mb-6"><MandateTabs mandateId={mandateId} activeTab="outreach" /></div><OutreachQueue key={mandateId} mandateId={mandateId} initialTargetId={targetId} disclosureApproved={mandate.brief.disclosureApproved} initialTargets={views} initialBuyerProfile={buyerProfile} /></div></>;
}
