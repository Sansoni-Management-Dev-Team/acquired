import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { AcquisitionRepository } from "@/db/acquisition-repository";
import { MandateNavigation } from "@/components/mandate-workspace";
import { CampaignStudio } from "@/components/campaign-studio";
import { listCampaignStudio } from "@/lib/campaign-service";
import { ensureDefaultCampaign } from "@/lib/default-campaign-service";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(`/sign-in?next=${encodeURIComponent("/mandates/" + id + "/outreach/sequences")}`);
  const organizationId = session.session.activeOrganizationId;
  if (!organizationId) redirect("/onboarding");
  const mandates = await new AcquisitionRepository(organizationId).listMandates();
  const mandate = mandates.find(item => item.id === id);
  if (!mandate) notFound();
  const actor = { organizationId, userId: session.user.id };
  await ensureDefaultCampaign(actor, id);
  const initialData = await listCampaignStudio(actor, id);
  return <><MandateNavigation mandates={mandates} selected={id} tab="sequences" /><CampaignStudio mandateId={id} mandateName={mandate.brief.name} initialData={initialData} initialView="sequences" /></>;
}
