import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { AcquisitionRepository } from "@/db/acquisition-repository";
import { MandateNavigation } from "@/components/mandate-workspace";
import { CampaignStudio } from "@/components/campaign-studio";
import { listCampaignStudio } from "@/lib/campaign-service";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(`/sign-in?next=${encodeURIComponent("/mandates/" + id + "/outreach/sequences")}`);
  const organizationId = session.session.activeOrganizationId;
  if (!organizationId) redirect("/onboarding");
  const [mandates, initialData] = await Promise.all([
    new AcquisitionRepository(organizationId).listMandates(),
    listCampaignStudio({ organizationId, userId: session.user.id }, id),
  ]);
  const mandate = mandates.find(item => item.id === id);
  if (!mandate) notFound();
  return <><MandateNavigation mandates={mandates} selected={id} tab="sequences" /><CampaignStudio mandateId={id} mandateName={mandate.brief.name} initialData={initialData} initialView="sequences" /></>;
}
