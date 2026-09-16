"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { authClient } from "@/lib/auth-client";

export function ResetPasswordForm({ token, invalid }: { token?: string; invalid?: boolean }) {
  const [error, setError] = useState(invalid || !token ? "This reset link is invalid or has expired." : "");
  const [complete, setComplete] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setLoading(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password"));
    if (password !== String(data.get("confirmPassword"))) {
      setError("Passwords do not match");
      setLoading(false);
      return;
    }
    const result = await authClient.resetPassword({ token, newPassword: password });
    setLoading(false);
    if (result.error) {
      setError(result.error.message || "Password reset failed");
      return;
    }
    setComplete(true);
  }

  if (complete) return <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--panel)] p-7"><p className="text-[var(--status-emerald)]">Your password has been updated and other sessions have been signed out.</p><Link href="/sign-in" className="mt-5 inline-flex rounded-md bg-[var(--accent)] px-4 py-2.5 font-semibold text-[var(--on-accent)]">Sign in</Link></div>;

  return <form onSubmit={submit} className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--panel)] p-7"><label className="text-sm" htmlFor="password">New password</label><input required disabled={!token || invalid} minLength={8} maxLength={128} id="password" name="password" type="password" autoComplete="new-password" className="mb-4 mt-2 w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-3 py-2.5 outline-none focus:border-[var(--accent)]" /><label className="text-sm" htmlFor="confirmPassword">Confirm new password</label><input required disabled={!token || invalid} minLength={8} maxLength={128} id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" className="mt-2 w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-3 py-2.5 outline-none focus:border-[var(--accent)]" />{error && <p role="alert" className="mt-3 text-sm text-[var(--status-red)]">{error}</p>}<button disabled={loading || !token || invalid} className="mt-5 w-full rounded-md bg-[var(--accent)] px-4 py-2.5 font-semibold text-[var(--on-accent)] disabled:opacity-50">{loading ? "Updating…" : "Update password"}</button><p className="mt-4 text-center text-xs text-[var(--muted)]"><Link href="/forgot-password" className="text-[var(--foreground)] underline underline-offset-4">Request another link</Link></p></form>;
}
