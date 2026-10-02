"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function GoogleAccountLink({ linked, email, failed }: { linked: boolean; email: string; failed: boolean }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(failed ? "Google could not be linked. Please select the Google account with the same email as your Acquired account and try again." : "");

  async function linkGoogle() {
    setLoading(true);
    setError("");
    try {
      const result = await authClient.linkSocial({
        provider: "google",
        callbackURL: "/settings",
        errorCallbackURL: "/settings?googleLink=error",
      });
      if (result.error) {
        setError(result.error.message || "Google could not be linked. Please try again.");
        setLoading(false);
      }
    } catch {
      setError("Google could not be reached. Please try again.");
      setLoading(false);
    }
  }

  return <div className="mb-5 mt-3">
    <p className="mb-3 text-sm text-[var(--muted)]">{linked ? "Google sign-in is linked to your account." : `Link the Google account for ${email} to use Google sign-in.`}</p>
    {!linked && <button type="button" disabled={loading} onClick={linkGoogle} className="rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[var(--on-accent)] disabled:opacity-50">{loading ? "Opening Google…" : "Link Google"}</button>}
    {error && <p role="alert" className="mt-3 text-sm text-[var(--status-red)]">{error}</p>}
  </div>;
}
