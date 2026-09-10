import Image from "next/image";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { OrganizationForm } from "@/components/organization-form";
import { auth } from "@/lib/auth";

export default async function OnboardingPage() {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) redirect("/sign-in");

  const organizations = await auth.api.listOrganizations({ headers: requestHeaders });
  if (organizations.some(organization => organization.id === session.session.activeOrganizationId)) {
    redirect("/targets");
  }
  if (organizations.length) redirect("/auth/complete");

  return <div className="grid min-h-screen place-items-center p-6"><div><div className="mb-3 flex items-center gap-3"><Image src="/acquired-crown.png" width={48} height={48} alt="Acquired crown" className="size-11 object-contain" priority /><p className="text-xs font-semibold uppercase tracking-[.18em] text-[var(--accent)]">Acquired</p></div><h1 className="mb-2 text-3xl font-semibold">Create your workspace</h1><p className="mb-6 max-w-md text-sm text-[var(--muted)]">Every target, message, and mailbox connection belongs to an organisation.</p><OrganizationForm /></div></div>;
}
