import { terminalResearchStates } from "@/domain/research";

export function ResearchRunOutcome({ status, remaining, active, canResume, busy, onResume }: {
  status: string; remaining: number; active: boolean; canResume: boolean; busy: boolean; onResume: () => void;
}) {
  if (active || !terminalResearchStates.includes(status)) return null;
  const title = status === "cancelled" ? "Research cancelled" : status === "failed" ? "Research failed" : status === "complete" ? "Research complete" : "Research paused";
  const detail = status === "cancelled"
    ? "Automatic research stopped when this run was cancelled. Saved results are retained."
    : status === "failed"
      ? "Research could not finish. You can retry the run."
      : status === "complete"
        ? "This run finished. Saved results are ready to review."
        : "This run ended before all work was finished. You can continue the run.";
  return <div className="space-y-3">
    <p role="status" className="text-sm font-medium">{title}{remaining > 0 ? ` — ${remaining} ${remaining === 1 ? "URL" : "URLs"} remaining` : ""}</p>
    <p className="text-sm text-[var(--muted)]">{detail}</p>
    {canResume && remaining > 0 && <button className="min-h-12 rounded-md border border-[var(--border)] px-4 py-2 text-sm disabled:opacity-40" disabled={busy} onClick={onResume}>{status === "cancelled" ? "Resume cancelled research" : "Continue research"}</button>}
  </div>;
}
