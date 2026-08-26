import { OutreachQueue } from "@/components/outreach-queue";

export default function OutreachPage() {
  return <div className="p-6 md:p-8"><p className="text-xs uppercase tracking-[.18em] text-[var(--accent)]">Human gate</p><h1 className="mt-2 text-3xl font-semibold">Outreach</h1><p className="mb-7 mt-3 max-w-2xl text-[var(--muted)]">Seven evidence-grounded touches. Approval is explicit and live delivery remains off.</p><OutreachQueue /></div>;
}
