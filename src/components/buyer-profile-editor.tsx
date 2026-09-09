"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { buyerProfileSchema, type BuyerProfile } from "@/domain/buyer-profile";

const fieldClass = "mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--panel-raised)] p-2 text-sm";
const publicFields = [
  ["senderName", "Sender name", "Your name", 100],
  ["background", "Operating background", "Your relevant operating and professional background", 500],
  ["investmentThesis", "Buyer introduction", "A general introduction to you as a buyer", 500],
  ["operatingIntent", "Operating intent and staff continuity", "How you intend to run the business and support its staff", 500],
  ["callToAction", "Call to action", "The next step you want to request", 240],
  ["signature", "Signature", "Your name and sign-off", 300],
] as const;
const emptyProfile: BuyerProfile = {
  senderName: "", background: "", investmentThesis: "", operatingIntent: "", callToAction: "", signature: "",
  buyerType: "trade", capitalAvailable: "Unknown", fundingForm: "Unknown", capitalConfirmed: false, publicProfileApproved: false,
};

export function BuyerProfileEditor({ initial, onSaved, onDirtyChange }: {
  initial: BuyerProfile | null;
  onSaved?: (profile: BuyerProfile) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const router = useRouter();
  const [profile, setProfile] = useState<BuyerProfile>(initial || emptyProfile);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(Boolean(initial));
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function update<K extends keyof BuyerProfile>(key: K, value: BuyerProfile[K]) {
    const isPublic = key === "buyerType" || publicFields.some(([field]) => field === key);
    setProfile(current => ({ ...current, [key]: value, ...(isPublic ? { publicProfileApproved: false } : {}) }));
    setDirty(true);
    setStatus("");
    setError("");
    onDirtyChange?.(true);
  }

  async function save() {
    setError("");
    const parsed = buyerProfileSchema.safeParse(profile);
    if (!parsed.success) {
      setError(parsed.error.issues.map(issue => {
        const label = publicFields.find(([key]) => key === issue.path[0])?.[1];
        return label ? `${label}: ${issue.message}` : issue.message;
      }).join(". "));
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
      setStatus("Buyer profile saved.");
      onDirtyChange?.(false);
      onSaved?.(result.profile);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Buyer profile could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return <details className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
    <summary className="cursor-pointer text-sm font-semibold">Buyer profile<span className="ml-2 text-xs font-normal text-[var(--muted)]">{dirty ? "Unsaved changes" : saved ? "Saved" : "Required"}</span></summary>
    <p className="mt-3 text-sm text-[var(--muted)]">Shared across all mandates. Changes saved here also appear in Brief and Outreach.</p>
    <form className="mt-4" onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset disabled={busy} className="min-w-0 space-y-4 disabled:opacity-60">
        <fieldset className="min-w-0 space-y-4">
          <legend className="mb-3 text-sm font-semibold">Public profile</legend>
          <label className="block text-sm">Buyer type<select className={fieldClass} value={profile.buyerType || ""} onChange={event => update("buyerType", event.target.value as BuyerProfile["buyerType"])}>
            <option value="" disabled>Select buyer type</option><option value="trade">Trade buyer</option><option value="financial">Financial buyer</option><option value="individual">Individual buyer</option>
          </select></label>
          {publicFields.map(([key, label, placeholder, maxLength]) => <label key={key} className="block text-sm">{label}
            {key === "senderName"
              ? <input required maxLength={maxLength} className={fieldClass} value={profile[key]} placeholder={placeholder} onChange={event => update(key, event.target.value)} />
              : <textarea required rows={2} maxLength={maxLength} className={`${fieldClass} resize-y`} value={profile[key]} placeholder={placeholder} onChange={event => update(key, event.target.value)} />}
          </label>)}
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={profile.publicProfileApproved || false} onChange={event => update("publicProfileApproved", event.target.checked)} />I approve sharing this public profile with the drafting provider and outreach recipients.</label>
          <p className="text-xs text-[var(--muted)]">Changes to public fields require approval again before generating drafts.</p>
        </fieldset>
        <details className="border-t border-[var(--border)] pt-4">
          <summary className="cursor-pointer text-sm font-semibold">Private capital details</summary>
          <p className="mt-2 text-xs text-[var(--muted)]">Never included in outreach. Leave as Unknown if unanswered.</p>
          <div className="mt-3 space-y-4">
            {([["capitalAvailable", "Capital available"], ["fundingForm", "Funding form"]] as const).map(([key, label]) => <label key={key} className="block text-sm">{label}<input className={fieldClass} maxLength={1000} value={profile[key] || ""} placeholder="Unknown" onChange={event => update(key, event.target.value)} /></label>)}
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={profile.capitalConfirmed || false} onChange={event => update("capitalConfirmed", event.target.checked)} />Capital amount and funding form confirmed</label>
          </div>
        </details>
        <button disabled={busy || (saved && !dirty)} className="rounded-md border border-[var(--border)] px-3 py-2 text-sm font-semibold disabled:opacity-40">{busy ? "Saving…" : "Save buyer profile"}</button>
      </fieldset>
      {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
      {status && <p role="status" className="mt-3 text-sm text-[var(--muted)]">{status}</p>}
    </form>
  </details>;
}
