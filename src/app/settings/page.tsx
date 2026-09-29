import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireDb } from "@/db/client";
import { mailboxConnections, organization } from "@/db/schema";
import { auth } from "@/lib/auth";
import { SignOutButton } from "@/components/sign-out-button";
import { ResearchSettingsForm } from "@/components/research-settings-form";
import { researchSettingsFromMetadata } from "@/domain/research-settings";
import { BuyerProfileEditor } from "@/components/buyer-profile-editor";
import { buyerProfileFromMetadata } from "@/domain/buyer-profile";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ gmail?: string; reason?: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in?next=/settings");
  const organizationId = session.session.activeOrganizationId;
  if (!organizationId) redirect("/onboarding");

  const [gmail] = await requireDb().select({
    address: mailboxConnections.address,
    scopes: mailboxConnections.scopes,
    reconnectRequired: mailboxConnections.reconnectRequired,
    dailyCap: mailboxConnections.dailyCap,
    updatedAt: mailboxConnections.updatedAt,
  }).from(mailboxConnections).where(and(
    eq(mailboxConnections.userId, session.user.id),
    eq(mailboxConnections.organizationId, organizationId),
    eq(mailboxConnections.provider, "gmail"),
  )).limit(1);
  const [org] = await requireDb().select({ metadata: organization.metadata }).from(organization).where(eq(organization.id, organizationId)).limit(1);

  const notice = await searchParams;
  const gmailConnected = Boolean(gmail && !gmail.reconnectRequired && gmail.scopes?.some((scope) => scope.endsWith("/gmail.compose")));
  const campaignReady = gmailConnected && Boolean(gmail?.scopes?.some(scope => scope.endsWith("/gmail.readonly")));

  return <div className="p-6 md:p-8">
    <p className="text-xs uppercase tracking-[.18em] text-[var(--accent)]">Account</p>
    <h1 className="mt-2 text-3xl font-semibold">Settings</h1>
    <p className="mb-7 mt-3 max-w-2xl text-[var(--muted)]">Manage your outreach profile, business research, sending mailbox and account.</p>
    {notice.gmail === "connected" && <p role="status" className="mb-5 rounded-md border border-emerald-800 bg-[var(--success-surface)] px-4 py-3 text-sm text-[var(--status-emerald)]">Gmail connected successfully.</p>}
    {notice.gmail === "error" && <p role="alert" className="mb-5 rounded-md border border-red-900 bg-[var(--error-surface)] px-4 py-3 text-sm text-[var(--status-red)]">Gmail connection failed{notice.reason ? `: ${notice.reason}` : "."}</p>}
    <div className="grid max-w-3xl gap-5">
      <BuyerProfileEditor initial={buyerProfileFromMetadata(org?.metadata)} />
      <ResearchSettingsForm initialTarget={researchSettingsFromMetadata(org?.metadata).defaultTargetBusinesses} />
      <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-6">
        <div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">Sending mailbox</h2><p className="mt-2 text-sm text-[var(--muted)]">Campaigns need Gmail compose permission to send and read-only permission to check for existing conversations and replies.</p></div><span className={`mt-1 shrink-0 text-xs ${gmailConnected ? "text-[var(--status-emerald)]" : "text-[var(--status-amber)]"}`}>{gmailConnected ? "Connected" : gmail ? "Reconnect required" : "Not connected"}</span></div>
        <dl className="my-5 space-y-3 text-sm">
          <div className="flex justify-between gap-4"><dt className="text-[var(--muted)]">Gmail account</dt><dd className="max-w-72 truncate font-medium">{gmail?.address || (gmail ? "Connected address unavailable" : "—")}</dd></div>
          <div className="flex justify-between"><dt className="text-[var(--muted)]">Daily cap</dt><dd>{gmail?.dailyCap ?? 100}</dd></div>
          <div className="flex justify-between"><dt className="text-[var(--muted)]">Permission</dt><dd className={gmail?.scopes?.some((scope) => scope.endsWith("/gmail.compose")) ? "text-[var(--status-emerald)]" : "text-[var(--muted)]"}>gmail.compose</dd></div>
          <div className="flex justify-between"><dt className="text-[var(--muted)]">Reply monitoring</dt><dd className={campaignReady ? "text-[var(--status-emerald)]" : "text-[var(--status-amber)]"}>{campaignReady ? "Ready" : "Reconnect for read-only access"}</dd></div>
          <div className="flex justify-between"><dt className="text-[var(--muted)]">Live sends</dt><dd>Only after campaign subscription confirmation</dd></div>
          {gmail?.updatedAt && <div className="flex justify-between"><dt className="text-[var(--muted)]">Connected</dt><dd>{gmail.updatedAt.toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short", timeZone: "Australia/Melbourne" })}</dd></div>}
        </dl>
        <a href="/api/mailbox/google/connect" className="inline-flex rounded-md border border-[var(--border)] px-4 py-2.5 text-sm hover:border-[var(--accent)]">{gmail ? "Reconnect Gmail" : "Connect Gmail"}</a>
        <p className="mt-3 text-xs text-[var(--muted)]">The mailbox address is read from Google after consent; refresh tokens remain encrypted at rest.</p>
      </section>
      <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-6"><h2 className="text-lg font-semibold">Account</h2><SignOutButton /></section>
    </div>
  </div>;
}
