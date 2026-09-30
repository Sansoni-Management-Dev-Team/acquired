import type { FirmableHistoryRepository } from "@/db/firmable-history-repository";
import { researchEnabled, researchWorker } from "./research-service";

type RecoverableFirmableRun = { id: string; status: string; updatedAt: Date };
export async function recoverFirmableRefreshes(history: Pick<FirmableHistoryRepository, "failRun">, runs: RecoverableFirmableRun[], mandateId: string, now = Date.now()) {
  if (!researchEnabled()) return;
  await Promise.allSettled(runs.map(async run => {
    if (run.status === "queued") {
      await researchWorker(`/firmable/${run.id}`, "POST", { mandateId }, 4_000);
      return;
    }
    if (run.status !== "running" || now - run.updatedAt.getTime() < 120_000) return;
    try {
      const worker = await researchWorker(`/firmable/${run.id}`, "GET", undefined, 4_000) as { status?: string };
      if (["complete", "errored", "terminated"].includes(worker.status || "")) await history.failRun(run.id, "Company data refresh ended before it could report completion. Start a new refresh to retry.");
    } catch {
      if (now - run.updatedAt.getTime() >= 600_000) await history.failRun(run.id, "Company data refresh timed out. Start a new refresh to retry; saved data remains available.");
    }
  }));
}

