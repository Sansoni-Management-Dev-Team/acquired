export type ContactEnrichmentRun = {
  id: string;
  targetId: string;
  status: string;
  companyStatus?: string;
  searchStatus?: string;
  profilesFound: number;
  profilesSaved: number;
  profilesFailed: number;
  message: string;
};

export const contactEnrichmentStages = ["Resolve company records", "Find decision makers", "Check contact details", "Prepare contact list"];
export function contactEnrichmentProgress(runs: ContactEnrichmentRun[], expectedIds: string[]) {
  const current = expectedIds.flatMap(id => runs.find(run => run.id === id) || []);
  const finished = current.length === expectedIds.length && current.length > 0 && current.every(run => !["queued", "running"].includes(run.status));
  const failed = finished && current.every(run => run.status === "failed");
  const stage = finished ? 3 : current.length === 0 || current.some(run => run.status === "queued" || !["complete", "failed"].includes(run.companyStatus || "")) ? 0
    : current.some(run => run.searchStatus !== "complete") ? 1 : 2;
  return { stage, finished, failed, saved: current.reduce((sum, run) => sum + run.profilesSaved, 0) };
}
