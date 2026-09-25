import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { AcquisitionRepository } from "@/db/acquisition-repository";
import { MandateNavigation } from "@/components/mandate-workspace";
import { CampaignStudio } from "@/components/campaign-studio";

export default async function CampaignsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(`/sign-in?next=${encodeURIComponent(`/mandates/${id}/outreach/campaigns`)}`);
  const organizationId = session.session.activeOrganizationId;
  if (!organizationId) redirect("/onboarding");
  const mandates = await new AcquisitionRepository(organizationId).listMandates();
  const mandate = mandates.find(item => item.id === id);
  if (!mandate) notFound();
  return <><MandateNavigation mandates={mandates} selected={id} tab="outreach" /><CampaignStudio mandateId={id} mandateName={mandate.brief.name} /></>;
}
