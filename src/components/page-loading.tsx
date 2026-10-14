"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ArrowLeft, LoaderCircle } from "lucide-react";

function LoadingView({ pathname, tab }: { pathname: string; tab?: string | null }) {
  const mandateId = pathname.match(/^\/mandates\/([^/]+)(?:\/|$)/)?.[1];
  const isMandate = Boolean(mandateId && mandateId !== "new");
  const people = isMandate && /\/people$/.test(pathname);
  const sequences = isMandate && /\/outreach\/sequences$/.test(pathname);
  const company = isMandate && /\/targets\/[^/]+$/.test(pathname);
  const authPage = ["/sign-in", "/sign-up", "/forgot-password", "/reset-password", "/onboarding", "/auth/complete"].includes(pathname);
  const title = people ? "People" : sequences ? "Sequences" : company ? "Company details"
    : isMandate ? (tab === "targets" ? "Companies" : tab === undefined ? "Mandate" : "Brief")
    : ({ "/": "Create a mandate", "/mandates/new": "Create a mandate", "/mandates": "Acquisition mandates", "/targets": "Acquisition mandates", "/settings": "Settings", "/audit": "Audit trail", "/outreach": "People", "/preview/outreach": "People", "/sign-in": "Sign in to the deal desk", "/sign-up": "Create your deal desk", "/forgot-password": "Reset your password", "/reset-password": "Choose a new password", "/onboarding": "Create your workspace", "/auth/complete": "Preparing your deal desk" }[pathname] ?? "Loading page");
  const description = people ? "Contacts with email addresses from research and company enrichment, with outreach progress."
    : sequences ? "Publish a sequence and subscribe contacts using your connected mailbox."
    : pathname === "/settings" ? "Manage your outreach profile, business research, channel connections and account."
    : pathname === "/mandates" ? "Keep each acquisition brief, target universe and pipeline separate." : undefined;
  return (
    <div className={authPage ? "mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-6 p-6" : "mx-auto max-w-[1680px] space-y-6 p-5 sm:p-8"}>
      {(people || sequences || company) && <Link href={sequences ? `/mandates/${mandateId}/people` : `/mandates/${mandateId}?tab=targets`} className="inline-flex items-center gap-2 text-sm text-[var(--muted)] hover:text-[var(--foreground)]"><ArrowLeft size={16} aria-hidden="true" />Back to {sequences ? "people" : "companies"}</Link>}
      <header><h1 className="text-3xl font-semibold sm:text-4xl">{title}</h1>{description && <p className="mt-2 text-sm text-[var(--muted)]">{description}</p>}</header>
      {pathname === "/mandates" && <Link href="/mandates/new" className="inline-block rounded bg-[var(--accent)] px-4 py-2 text-[var(--on-accent)]">Create a mandate</Link>}
      <section aria-busy="true" aria-label={`${title} data`} className="flex min-h-64 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--panel)] p-6">
        <div role="status" className="flex flex-col items-center gap-3 text-sm text-[var(--muted)]"><LoaderCircle size={26} aria-hidden="true" className="animate-spin motion-reduce:animate-none text-[var(--accent)]" /><span>Loading {title.toLowerCase()}…</span></div>
      </section>
    </div>
  );
}

function QueryLoadingView({ pathname }: { pathname: string }) {
  const query = useSearchParams();
  return <LoadingView pathname={pathname} tab={query.get("tab")} />;
}

export function PageLoading() {
  const pathname = usePathname();
  // Query parameters can suspend on a direct visit. Keep the shell visible then too.
  return <Suspense fallback={<LoadingView pathname={pathname} />}><QueryLoadingView pathname={pathname} /></Suspense>;
}
