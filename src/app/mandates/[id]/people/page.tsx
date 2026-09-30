import { FirmableHistoryRepository } from "@/db/firmable-history-repository";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { AcquisitionRepository } from "@/db/acquisition-repository";
import { MandateNavigation } from "@/components/mandate-workspace";
import { CampaignStudio } from "@/components/campaign-studio";
import { listCampaignStudio } from "@/lib/campaign-service";
import { Suspense } from "react";
import { PageLoading } from "@/components/page-loading";

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ enrichmentRuns?: string | string[] }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { enrichmentRuns: rawRuns } = await searchParams;
  return <Suspense key={`${id}:${JSON.stringify(rawRuns) ?? "all"}`} fallback={<PageLoading />}><PeopleContent id={id} rawRuns={rawRuns} /></Suspense>;
}

async function PeopleContent({ id, rawRuns }: { id: string; rawRuns?: string | string[] }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(`/sign-in?next=${encodeURIComponent("/mandates/" + id + "/people")}`);
  const organizationId = session.session.activeOrganizationId;
  if (!organizationId) redirect("/onboarding");
  const [mandates, initialData] = await Promise.all([
    new AcquisitionRepository(organizationId).listMandates(),
    listCampaignStudio({ organizationId, userId: session.user.id }, id),
  ]);
  const mandate = mandates.find(item => item.id === id);
  if (!mandate) notFound();
  const runIds = typeof rawRuns === "string" ? rawRuns.split(",") : [];
  const filteredContactIds = rawRuns === undefined ? undefined : runIds.length <= 20 && runIds.every(runId => z.uuid().safeParse(runId).success)
    ? await new FirmableHistoryRepository().contactIdsForRuns(organizationId, id, runIds) : [];
  return <><MandateNavigation mandates={mandates} selected={id} tab="people" /><CampaignStudio key={typeof rawRuns === "string" ? rawRuns : "all"} mandateId={id} mandateName={mandate.brief.name} initialData={initialData} initialView="contacts" enrichmentContactIds={filteredContactIds} /></>;
}
