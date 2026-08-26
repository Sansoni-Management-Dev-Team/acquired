"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { authClient } from "@/lib/auth-client";

export function ForgotPasswordForm() {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const result = await authClient.requestPasswordReset({
      email: String(data.get("email")).trim(),
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (result.error) {
      setError(result.error.message || "Password reset is temporarily unavailable");
      return;
    }
    setMessage("If that email is registered, a reset link is on its way.");
  }

  return <form onSubmit={submit} className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--panel)] p-7"><label className="text-sm" htmlFor="email">Email</label><input required id="email" name="email" type="email" autoComplete="email" className="mt-2 w-full rounded-md border border-[var(--border)] bg-black/20 px-3 py-2.5 outline-none focus:border-[var(--accent)]" />{error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}{message && <p role="status" className="mt-3 text-sm text-emerald-300">{message}</p>}<button disabled={loading || Boolean(message)} className="mt-5 w-full rounded-md bg-[var(--accent)] px-4 py-2.5 font-semibold text-black disabled:opacity-50">{loading ? "Sending…" : "Send reset link"}</button><p className="mt-4 text-center text-xs text-[var(--muted)]"><Link href="/sign-in" className="text-white underline underline-offset-4">Back to sign in</Link></p></form>;
}
