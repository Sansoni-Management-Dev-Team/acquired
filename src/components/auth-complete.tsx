"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export function AuthComplete() {
  const router = useRouter();
  const started = useRef(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const organizations = await authClient.organization.list();
      if (organizations.error) {
        setError(organizations.error.message || "Could not load your workspace");
        return;
      }
      if (!organizations.data?.length) {
        router.replace("/onboarding");
        router.refresh();
        return;
      }
      const activation = await authClient.organization.setActive({ organizationId: organizations.data[0].id });
      if (activation.error) {
        setError(activation.error.message || "Could not activate your workspace");
        return;
      }
      router.replace("/targets");
      router.refresh();
    })();
  }, [router]);

  if (error) return <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--panel)] p-7"><p role="alert" className="text-[var(--status-red)]">{error}</p><Link href="/sign-in" className="mt-5 inline-flex text-sm text-[var(--foreground)] underline underline-offset-4">Return to sign in</Link></div>;
  return <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--panel)] p-7 text-sm text-[var(--muted)]">Finishing sign-in…</div>;
}
