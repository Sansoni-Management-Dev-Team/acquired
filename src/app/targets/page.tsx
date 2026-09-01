import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { TargetsDashboard } from "@/components/targets-dashboard";
import { requireDb } from "@/db/client";
import { OrganizationRepository } from "@/db/repositories";
import { auth } from "@/lib/auth";

export default async function TargetsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in?next=/targets");
  const organizationId = session.session.activeOrganizationId;
  if (!organizationId) redirect("/onboarding");

  const targets = await new OrganizationRepository(requireDb(), organizationId).listRankedTargets();
  return <TargetsDashboard initialTargets={targets} providerMode={process.env.TARGET_DATA_PROVIDER === "fixture" ? "fixture" : "live"} />;
}
