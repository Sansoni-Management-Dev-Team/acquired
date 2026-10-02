"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function GoogleSignInButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function signIn() {
    setLoading(true);
    setError("");
    const result = await authClient.signIn.social({
      provider: "google",
      callbackURL: "/auth/complete",
      newUserCallbackURL: "/auth/complete",
      errorCallbackURL: "/sign-in",
    });
    if (result?.error) {
      setError(result.error.message || "Google sign-in failed");
      setLoading(false);
    }
  }

  return <div><button type="button" onClick={signIn} disabled={loading} className="w-full rounded-md border border-[var(--border)] bg-[var(--accent)] px-4 py-2.5 font-semibold text-[var(--on-accent)] transition hover:bg-[var(--accent-hover)] disabled:opacity-50">{loading ? "Opening Google…" : "Continue with Google"}</button>{error && <p role="alert" className="mt-3 text-sm text-[var(--status-red)]">{error}</p>}<div className="my-5 flex items-center gap-3 text-xs uppercase tracking-[.16em] text-[var(--muted)]"><span className="h-px flex-1 bg-[var(--border)]" /><span>or</span><span className="h-px flex-1 bg-[var(--border)]" /></div></div>;
}
