import { MandateBuilder } from "@/components/mandate-builder";

export default function MandatePage() {
  return <div className="p-6 md:p-8"><p className="text-xs uppercase tracking-[.18em] text-[var(--accent)]">Acquisition criteria</p><h1 className="mt-2 text-3xl font-semibold">Mandate</h1><p className="mb-7 mt-3 max-w-2xl text-[var(--muted)]">Turn an investment thesis into explicit filters before sourcing begins.</p><MandateBuilder /></div>;
}
