"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { buyerProfileSchema, type BuyerProfile } from "@/domain/buyer-profile";

const fieldClass = "mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--panel-raised)] px-3 py-3 text-sm";
const emptyProfile: BuyerProfile = { senderName: "", about: "", exampleEmail: "", signature: "" };

export function BuyerProfileEditor({ initial, onSaved, onDirtyChange }: {
  initial: BuyerProfile | null;
  onSaved?: (profile: BuyerProfile) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const router = useRouter();
  const [profile, setProfile] = useState<BuyerProfile>(() => initial ? {
    senderName: initial.senderName,
    about: initial.about || [initial.background, initial.investmentThesis, initial.operatingIntent].filter(Boolean).join(" ").slice(0, 1500),
    exampleEmail: initial.exampleEmail || "",
    signature: initial.signature,
  } : emptyProfile);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(Boolean(initial));
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function update(key: "senderName" | "about" | "exampleEmail" | "signature", value: string) {
    setProfile(current => ({ ...current, [key]: value }));
    setDirty(true);
    setStatus("");
    setError("");
    onDirtyChange?.(true);
  }

  async function save() {
    setError("");
    const parsed = buyerProfileSchema.safeParse(profile);
    if (!parsed.success) {
      setError(parsed.error.issues.map(issue => issue.message).join(". "));
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/outreach/profile", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data),
      });
      const result = await response.json() as { profile?: BuyerProfile; error?: string };
      if (!response.ok || !result.profile) throw new Error(result.error || "Buyer profile could not be saved.");
      setProfile(result.profile);
      setDirty(false);
      setSaved(true);
      setStatus("Outreach profile saved.");
      onDirtyChange?.(false);
      onSaved?.(result.profile);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Buyer profile could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-6" aria-labelledby="buyer-profile-heading">
    <h2 id="buyer-profile-heading" className="text-lg font-semibold">Outreach profile</h2>
    <p className="mt-2 text-sm text-[var(--muted)]">These details are shared across your mandates and help personalize outreach drafts.</p>
    <form className="mt-5" onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset disabled={busy} className="min-w-0 space-y-5 disabled:opacity-60">
        <label className="block text-sm font-medium">Sender name
          <input required maxLength={100} className={fieldClass} value={profile.senderName} placeholder="Your name" onChange={event => update("senderName", event.target.value)} />
        </label>
        <label className="block text-sm font-medium">Tell us a bit about yourself
          <textarea required rows={4} maxLength={1500} className={`${fieldClass} resize-y`} value={profile.about || ""} placeholder="Your background and why you are interested in acquiring a business" onChange={event => update("about", event.target.value)} />
          <span className="mt-1 block text-xs font-normal text-[var(--muted)]">We use this to personalize outreach. Only include details you are comfortable sharing with recipients.</span>
        </label>
        <label className="block text-sm font-medium">Example outreach email
          <textarea rows={7} maxLength={5000} className={`${fieldClass} resize-y`} value={profile.exampleEmail || ""} placeholder="Paste an email that captures your preferred tone and style" onChange={event => update("exampleEmail", event.target.value)} />
          <span className="mt-1 block text-xs font-normal text-[var(--muted)]">Used as a style reference, not as a source of facts about you or a company.</span>
        </label>
        <label className="block text-sm font-medium">Email sign-off
          <textarea required rows={3} maxLength={300} className={`${fieldClass} resize-y`} value={profile.signature} placeholder="Kind regards, ..." onChange={event => update("signature", event.target.value)} />
        </label>
        <button disabled={busy || (saved && !dirty)} className="min-h-12 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--on-accent)] disabled:opacity-40">{busy ? "Saving…" : "Save outreach profile"}</button>
      </fieldset>
      {error && <p role="alert" className="mt-3 text-sm text-[var(--status-red)]">{error}</p>}
      {status && <p role="status" className="mt-3 text-sm text-[var(--muted)]">{status}</p>}
    </form>
  </section>;
}
