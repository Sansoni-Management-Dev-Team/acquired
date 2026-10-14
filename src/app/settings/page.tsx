import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireDb } from "@/db/client";
import { organization } from "@/db/schema";
import { auth } from "@/lib/auth";
import { SignOutButton } from "@/components/sign-out-button";
import { ResearchSettingsForm } from "@/components/research-settings-form";
import { researchSettingsFromMetadata } from "@/domain/research-settings";
import { BuyerProfileEditor } from "@/components/buyer-profile-editor";
import { buyerProfileFromMetadata } from "@/domain/buyer-profile";
import { ChannelConnections } from "@/components/channel-connections";
import { GoogleAccountLink } from "@/components/google-account-link";
export default async function SettingsPage({ searchParams }: {
    searchParams: Promise<{
        googleLink?: string;
        setup?: string;
    }>;
}) {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session)
        redirect("/sign-in?next=/settings");
    const organizationId = session.session.activeOrganizationId;
    if (!organizationId)
        redirect("/onboarding");
    const [org] = await requireDb().select({ metadata: organization.metadata }).from(organization).where(eq(organization.id, organizationId)).limit(1);
    const notice = await searchParams;
    const accounts = await auth.api.listUserAccounts({ headers: await headers() });
    const googleLinked = accounts.some((account) => account.providerId === "google");
    return <div className="p-6 md:p-8">
    <p className="text-xs uppercase tracking-[.18em] text-[var(--accent)]">Account</p>
    <h1 className="mt-2 text-3xl font-semibold">Settings</h1>
    <p className="mb-7 mt-3 max-w-2xl text-[var(--muted)]">Manage your outreach profile, business research, channel connections and account.</p>
    <div className="grid max-w-3xl gap-5">
      <BuyerProfileEditor initial={buyerProfileFromMetadata(org?.metadata)}/>
      <ResearchSettingsForm initialTarget={researchSettingsFromMetadata(org?.metadata).defaultTargetBusinesses}/>
      <ChannelConnections setupReturned={notice.setup === "returned"} />
      <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-6"><h2 className="text-lg font-semibold">Account</h2><GoogleAccountLink linked={googleLinked} email={session.user.email} failed={notice.googleLink === "error"}/><SignOutButton /></section>
    </div>
  </div>;
}
