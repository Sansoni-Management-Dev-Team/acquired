"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { authClient } from "@/lib/auth-client";

export function SignInForm({ redirectTo = "/targets" }: { redirectTo?: string }) {
  const router = useRouter();
  const [error, setError] = useState(""); const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError("");
    const data = new FormData(event.currentTarget);
    const result = await authClient.signIn.email({ email: String(data.get("email")), password: String(data.get("password")), callbackURL: "/targets" });
    if (result.error) {
      setError(result.error.message || "Sign in failed");
      setLoading(false);
      return;
    }
    const organizations = await authClient.organization.list();
    if (!organizations.data?.length) {
      router.replace("/onboarding");
      router.refresh();
      return;
    }
    await authClient.organization.setActive({ organizationId: organizations.data[0].id });
    router.replace(redirectTo);
    router.refresh();
  }
  return <form onSubmit={submit} className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--panel)] p-7"><label className="text-sm" htmlFor="email">Email</label><input required id="email" name="email" type="email" autoComplete="email" className="mb-4 mt-2 w-full rounded-md border border-[var(--border)] bg-black/20 px-3 py-2.5 outline-none focus:border-[var(--accent)]" /><div className="flex items-center justify-between"><label className="text-sm" htmlFor="password">Password</label><Link href="/forgot-password" className="text-xs text-[var(--muted)] underline underline-offset-4 hover:text-white">Forgot password?</Link></div><input required minLength={8} maxLength={128} id="password" name="password" type="password" autoComplete="current-password" className="mt-2 w-full rounded-md border border-[var(--border)] bg-black/20 px-3 py-2.5 outline-none focus:border-[var(--accent)]" />{error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}<button disabled={loading} className="mt-5 w-full rounded-md bg-[var(--accent)] px-4 py-2.5 font-semibold text-black disabled:opacity-50">{loading ? "Signing in…" : "Sign in"}</button><p className="mt-4 text-center text-xs text-[var(--muted)]">New to Acquired? <Link href="/sign-up" className="text-white underline underline-offset-4">Create an account</Link></p></form>;
}
