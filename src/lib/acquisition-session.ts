import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./auth";
export async function acquisitionSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in?next=/mandates");
  if (!session.session.activeOrganizationId) redirect("/onboarding");
  return { session, organizationId: session.session.activeOrganizationId };
}
