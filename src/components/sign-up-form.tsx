"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { organizationSlug } from "@/lib/organization-slug";
import { GoogleSignInButton } from "@/components/google-sign-in-button";

export function SignUpForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    const data = new FormData(event.currentTarget);
    const name = String(data.get("name")).trim();
    const organizationName = String(data.get("organizationName")).trim();
    const registration = await authClient.signUp.email({
      name,
      email: String(data.get("email")).trim(),
      password: String(data.get("password")),
    });

    if (registration.error) {
      setError(registration.error.message || "Registration failed");
      setLoading(false);
      return;
    }

    const workspace = await authClient.organization.create({
      name: organizationName,
      slug: organizationSlug(organizationName, crypto.randomUUID()),
    });

    if (workspace.error) {
      router.replace("/onboarding");
      router.refresh();
      return;
    }

    router.replace("/targets");
    router.refresh();
  }

  return (
    <form method="post" action="/api/auth/form-unavailable" onSubmit={submit} className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--panel)] p-7">
      <GoogleSignInButton />
      <label className="text-sm" htmlFor="name">Your name</label>
      <input required id="name" name="name" autoComplete="name" className="mb-4 mt-2 w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-3 py-2.5 outline-none focus:border-[var(--accent)]" />
      <label className="text-sm" htmlFor="organizationName">Organisation</label>
      <input required id="organizationName" name="organizationName" autoComplete="organization" className="mb-4 mt-2 w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-3 py-2.5 outline-none focus:border-[var(--accent)]" />
      <label className="text-sm" htmlFor="email">Email</label>
      <input required id="email" name="email" type="email" autoComplete="email" className="mb-4 mt-2 w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-3 py-2.5 outline-none focus:border-[var(--accent)]" />
      <label className="text-sm" htmlFor="password">Password</label>
      <input required minLength={8} maxLength={128} id="password" name="password" type="password" autoComplete="new-password" className="mt-2 w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-3 py-2.5 outline-none focus:border-[var(--accent)]" />
      <p className="mt-2 text-xs text-[var(--muted)]">Use at least 8 characters.</p>
      {error && <p role="alert" className="mt-3 text-sm text-[var(--status-red)]">{error}</p>}
      <button disabled={loading} className="mt-5 w-full rounded-md bg-[var(--accent)] px-4 py-2.5 font-semibold text-[var(--on-accent)] disabled:opacity-50">{loading ? "Creating account…" : "Create account"}</button>
      <p className="mt-4 text-center text-xs text-[var(--muted)]">Already registered? <Link href="/sign-in" className="text-[var(--foreground)] underline underline-offset-4">Sign in</Link></p>
    </form>
  );
}
