import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { AcquisitionRepository } from "@/db/acquisition-repository";
import { MandateNavigation } from "@/components/mandate-workspace";
import { OutreachStudioPrototype } from "@/components/outreach-studio-prototype";

export default async function OutreachPrototypePage({ params }: { params: Promise<{ id: string }> }) {
  if (process.env.NODE_ENV !== "development") notFound();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(`/sign-in?next=${encodeURIComponent(`/mandates/${id}/outreach/prototype`)}`);
  const organizationId = session.session.activeOrganizationId;
  if (!organizationId) redirect("/onboarding");
  const mandates = await new AcquisitionRepository(organizationId).listMandates();
  const mandate = mandates.find((item) => item.id === id);
  if (!mandate) notFound();

  return <>
    <MandateNavigation mandates={mandates} selected={id} tab="outreach" />
    <OutreachStudioPrototype mandateId={id} mandateName={mandate.brief.name} />
  </>;
}
