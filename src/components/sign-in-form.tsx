"use client";

import { FormEvent, useState } from "react";
import { authClient } from "@/lib/auth-client";

export function SignInForm() {
  const [error, setError] = useState(""); const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError("");
    const data = new FormData(event.currentTarget);
    const result = await authClient.signIn.email({ email: String(data.get("email")), password: String(data.get("password")), callbackURL: "/targets" });
    if (result.error) setError(result.error.message || "Sign in failed");
    setLoading(false);
  }
  return <form onSubmit={submit} className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--panel)] p-7"><label className="text-sm" htmlFor="email">Email</label><input required id="email" name="email" type="email" className="mb-4 mt-2 w-full rounded-md border border-[var(--border)] bg-black/20 px-3 py-2.5 outline-none focus:border-[var(--accent)]" /><label className="text-sm" htmlFor="password">Password</label><input required minLength={12} id="password" name="password" type="password" className="mt-2 w-full rounded-md border border-[var(--border)] bg-black/20 px-3 py-2.5 outline-none focus:border-[var(--accent)]" />{error && <p className="mt-3 text-sm text-red-300">{error}</p>}<button disabled={loading} className="mt-5 w-full rounded-md bg-[var(--accent)] px-4 py-2.5 font-semibold text-black disabled:opacity-50">{loading ? "Signing in…" : "Sign in"}</button><p className="mt-4 text-xs leading-5 text-[var(--muted)]">Accounts are invitation-only. Product identity and the delegated Gmail grant are intentionally separate.</p></form>;
}
