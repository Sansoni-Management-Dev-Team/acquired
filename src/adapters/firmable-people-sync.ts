import type { ContactProvider, PersonCandidate, PersonDetail } from "./source-contracts";

export type FirmablePeopleSyncResult = { found: number; saved: number; failed: number };

export async function syncAllFirmablePeople(
  firmable: Pick<ContactProvider, "searchAllPeople" | "enrichPerson">,
  companyId: string,
  save: (person: PersonDetail, candidate: PersonCandidate) => Promise<void>,
  concurrency = 5,
  onCandidates?: (candidates: PersonCandidate[]) => Promise<void> | void,
): Promise<FirmablePeopleSyncResult> {
  const candidates = await firmable.searchAllPeople(companyId);
  await onCandidates?.(candidates);
  let saved = 0;
  let failed = 0;
  const batchSize = Math.max(1, concurrency);

  for (let index = 0; index < candidates.length; index += batchSize) {
    const results = await Promise.allSettled(candidates.slice(index, index + batchSize).map(async (candidate) => {
      const person = await firmable.enrichPerson({ id: candidate.id });
      await save(person, candidate);
    }));
    for (const result of results) {
      if (result.status === "fulfilled") saved++;
      else failed++;
    }
  }

  return { found: candidates.length, saved, failed };
}
