import Image from "next/image";
import { SignInForm } from "@/components/sign-in-form";
import { safeRedirectPath } from "@/lib/safe-redirect-path";
import { LegalLinks } from "@/components/legal-page";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const authError = error === "account_not_linked"
    ? "An account with this email already exists. Sign in with your password, then open Settings → Account → Link Google to enable Google sign-in."
    : error ? "Google sign-in could not be completed. Please try again or sign in with your password." : undefined;
  return <div className="grid min-h-screen place-items-center px-6 py-16"><div className="w-full max-w-md"><div className="mb-3 flex items-center gap-3"><Image src="/acquired-crown.png" width={48} height={48} alt="Acquired crown" className="size-11 object-contain theme-logo" priority /><p className="text-xs font-semibold uppercase tracking-[.18em] text-[var(--accent)]">Acquired</p></div><h1 className="mb-3 text-3xl font-semibold">Sign in to the deal desk</h1><p className="mb-6 text-sm leading-6 text-[var(--muted)]">Acquired helps you research businesses, manage your acquisition pipeline and prepare outreach. Save outreach drafts in your workspace and manage channel connections through Unipile.</p><SignInForm redirectTo={safeRedirectPath(next)} authError={authError} /><footer className="mt-6"><LegalLinks /></footer></div></div>;
}
