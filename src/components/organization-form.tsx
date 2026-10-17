"use client";

import { randomUuid } from "@/lib/random-uuid";


import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { organizationSlug } from "@/lib/organization-slug";

export function OrganizationForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const name = String(data.get("organizationName")).trim();
    const result = await authClient.organization.create({ name, slug: organizationSlug(name, randomUuid()) });
    if (result.error) {
      setError(result.error.message || "Workspace creation failed");
      setLoading(false);
      return;
    }
    router.replace("/targets");
    router.refresh();
  }

  return <form onSubmit={submit} className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--panel)] p-7"><label className="text-sm" htmlFor="organizationName">Organisation</label><input required autoFocus id="organizationName" name="organizationName" autoComplete="organization" className="mt-2 w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-3 py-2.5 outline-none focus:border-[var(--accent)]" />{error && <p role="alert" className="mt-3 text-sm text-[var(--status-red)]">{error}</p>}<button disabled={loading} className="mt-5 w-full rounded-md bg-[var(--accent)] px-4 py-2.5 font-semibold text-[var(--on-accent)] disabled:opacity-50">{loading ? "Creating workspace…" : "Create workspace"}</button></form>;
}
