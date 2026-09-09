import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireDb } from "@/db/client";
import { mailboxConnections } from "@/db/schema";
import { auth } from "@/lib/auth";
import { FREE_DRAFT_MODELS } from "@/adapters/ai/free-provider";

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

  const notice = await searchParams;
  const fixtureMode = process.env.TARGET_DATA_PROVIDER === "fixture";
  const fixtureDrafting = process.env.OUTREACH_DRAFTING_PROVIDER === "fixture";
  const freeAi = process.env.AI_PROVIDER === "openrouter-free";
  const outreachModels = freeAi ? FREE_DRAFT_MODELS.join(" → ") : process.env.OUTREACH_AI_MODELS || process.env.OUTREACH_AI_MODEL || "";
  const aiConfigured = (freeAi || process.env.AI_PROVIDER === "openrouter") && Boolean(process.env.OPENROUTER_API_KEY && outreachModels);
  const localDatabase = process.env.DATABASE_DRIVER === "postgres";
  const connections = [
    { name: localDatabase ? "OrbStack PostgreSQL" : "Neon Postgres", state: "Connected", detail: localDatabase ? "Local project_acquire database" : "Deployed database", tone: "text-[var(--accent)]" },
    { name: "Google Places", state: fixtureMode ? "Fixture mode" : process.env.GOOGLE_PLACES_API_KEY ? "Key configured" : "Not configured", detail: fixtureMode ? "No external discovery requests" : "Company discovery", tone: fixtureMode || process.env.GOOGLE_PLACES_API_KEY ? "text-[var(--accent)]" : "text-[var(--muted)]" },
    { name: "Firmable", state: fixtureMode ? "Fixture mode" : process.env.FIRMABLE_API_KEY ? "Key configured" : "Not configured", detail: fixtureMode ? "No external enrichment requests" : "Company enrichment and in-company people search", tone: fixtureMode || process.env.FIRMABLE_API_KEY ? "text-[var(--accent)]" : "text-[var(--muted)]" },
    { name: "Outreach drafting", state: fixtureDrafting ? "Fixture mode" : aiConfigured ? "OpenRouter configured" : "Not configured", detail: fixtureDrafting ? "Deterministic seven-message generation" : `${process.env.AI_PROVIDER || "No AI provider"} · ${outreachModels || "No model"}`, tone: fixtureDrafting || aiConfigured ? "text-[var(--accent)]" : "text-[var(--muted)]" },
  ];
  const gmailConnected = Boolean(gmail && !gmail.reconnectRequired && gmail.scopes?.some((scope) => scope.endsWith("/gmail.compose")));

  return <div className="p-6 md:p-8">
    <p className="text-xs uppercase tracking-[.18em] text-[var(--accent)]">Connections and controls</p>
    <h1 className="mt-2 text-3xl font-semibold">Settings</h1>
    <p className="mb-7 mt-3 max-w-2xl text-[var(--muted)]">Provider status is shown without exposing credentials.</p>
    {notice.gmail === "connected" && <p role="status" className="mb-5 rounded-md border border-emerald-800 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-300">Gmail connected successfully.</p>}
    {notice.gmail === "error" && <p role="alert" className="mb-5 rounded-md border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300">Gmail connection failed{notice.reason ? `: ${notice.reason}` : "."}</p>}
    <div className="grid gap-5 xl:grid-cols-2">
      <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-6"><h2 className="text-lg font-semibold">Data providers</h2><div className="mt-4 divide-y divide-[var(--border)]">{connections.map((connection) => <div key={connection.name} className="flex items-start justify-between gap-4 py-4"><div><h3 className="text-sm font-medium">{connection.name}</h3><p className="mt-1 text-xs text-[var(--muted)]">{connection.detail}</p></div><span className={`shrink-0 text-xs ${connection.tone}`}>{connection.state}</span></div>)}</div></section>
      <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-6">
        <div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">Sending mailbox</h2><p className="mt-2 text-sm text-[var(--muted)]">Gmail uses a separate delegated grant with the <code>gmail.compose</code> scope so approved outreach can be saved as Gmail drafts.</p></div><span className={`mt-1 shrink-0 text-xs ${gmailConnected ? "text-emerald-300" : "text-amber-300"}`}>{gmailConnected ? "Connected" : gmail ? "Reconnect required" : "Not connected"}</span></div>
        <dl className="my-5 space-y-3 text-sm">
          <div className="flex justify-between gap-4"><dt className="text-[var(--muted)]">Gmail account</dt><dd className="max-w-72 truncate font-medium">{gmail?.address || (gmail ? "Connected address unavailable" : "—")}</dd></div>
          <div className="flex justify-between"><dt className="text-[var(--muted)]">Daily cap</dt><dd>{gmail?.dailyCap ?? 100}</dd></div>
          <div className="flex justify-between"><dt className="text-[var(--muted)]">Permission</dt><dd className={gmail?.scopes?.some((scope) => scope.endsWith("/gmail.compose")) ? "text-emerald-300" : "text-[var(--muted)]"}>gmail.compose</dd></div>
          <div className="flex justify-between"><dt className="text-[var(--muted)]">Live sends</dt><dd className="text-amber-300">Disabled</dd></div>
          {gmail?.updatedAt && <div className="flex justify-between"><dt className="text-[var(--muted)]">Connected</dt><dd>{gmail.updatedAt.toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short", timeZone: "Australia/Melbourne" })}</dd></div>}
        </dl>
        <a href="/api/mailbox/google/connect" className="inline-flex rounded-md border border-[var(--border)] px-4 py-2.5 text-sm hover:border-[var(--accent)]">{gmail ? "Reconnect Gmail" : "Connect Gmail"}</a>
        <p className="mt-3 text-xs text-[var(--muted)]">The mailbox address is read from Google after consent; refresh tokens remain encrypted at rest.</p>
      </section>
    </div>
  </div>;
}
