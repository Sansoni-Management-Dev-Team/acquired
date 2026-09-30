import { notFound, permanentRedirect } from "next/navigation";
import { z } from "zod";
import { mandatePeopleHref } from "@/domain/mandate-navigation";

export default async function CampaignsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  permanentRedirect(mandatePeopleHref(id));
}
