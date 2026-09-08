import { notFound } from "next/navigation";
import { z } from "zod";
import { AcquisitionRepository } from "@/db/acquisition-repository";
import { acquisitionSession } from "@/lib/acquisition-session";
import { TargetWorksheet } from "@/components/target-worksheet";
export default async function TargetPage({ params }: { params: Promise<{ id: string; targetId: string }> }) {
  const { organizationId } = await acquisitionSession();
  const { id, targetId } = await params;
  if (![id,targetId].every(value => z.string().uuid().safeParse(value).success)) notFound();
  const repo = new AcquisitionRepository(organizationId);
  const mandates = await repo.listMandates();
  const mandate = mandates.find(m => m.id === id);
  if (!mandate) notFound();
  const member = (await repo.memberships(id)).find(m => m.target.id === targetId);
  if (!member) notFound();
  return <TargetWorksheet mandates={mandates} mandate={mandate} initial={member} />;
}
