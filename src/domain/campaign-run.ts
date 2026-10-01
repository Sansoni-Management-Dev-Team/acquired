import { campaignPathFor, campaignStepEntries, type CampaignDefinition } from "./campaign";
export type CampaignRun = {
  id: string; label: string; version: number; definition: CampaignDefinition; state: string; stopReason: string | null;
  stepIndex: number; nextStepAt: string | null; retryStepIndex?: number | null;
  attempts: { stepId: string; state: string; sentAt: string | null }[];
};
export function campaignRunStatuses(run: CampaignRun, now = Date.now()) {
  const entries = campaignStepEntries(run.definition);
  const statuses = new Map<string, string>();
  statuses.set("start", "Subscribed");
  for (const [index, entry] of entries.entries()) {
    const attempt = run.attempts.find(attempt => attempt.stepId === entry.step.id);
    if (attempt?.state === "sent") statuses.set(entry.step.id, "Sent");
    else if (attempt?.state === "unknown") statuses.set(entry.step.id, "Needs review");
    else if (entry.split && entry.path !== campaignPathFor(entry.split, run.id)) statuses.set(entry.step.id, "Skipped");
    else if (index === run.stepIndex || entry.step.kind === "wait" && index === run.stepIndex - 1) {
      const status = run.state === "stopped" ? "Stopped" : run.state === "paused" ? "Paused" : run.state === "needs_review" ? "Needs review" : attempt?.state === "claimed" ? "Sending" : run.retryStepIndex === run.stepIndex ? "Retry scheduled" : run.nextStepAt && new Date(run.nextStepAt).getTime() > now ? entry.step.kind === "wait" ? "Waiting" : "Scheduled" : "Ready";
      statuses.set(entry.step.id, status);
    } else if (entry.step.kind === "wait" && run.attempts.some(attempt => attempt.stepId === entries[index + 1]?.step.id && attempt.state === "sent")) statuses.set(entry.step.id, "Elapsed");
    else statuses.set(entry.step.id, "Pending");
  }
  for (const split of run.definition.splits || []) {
    const anchorSent = run.attempts.some(attempt => attempt.stepId === split.afterStepId && attempt.state === "sent");
    statuses.set(split.id, anchorSent ? `Path ${campaignPathFor(split, run.id) === "pathA" ? "A" : "B"}` : "Pending");
  }
  statuses.set("end", run.state === "completed" ? "Completed" : run.state === "stopped" ? "Stopped" : "Pending");
  return statuses;
}
