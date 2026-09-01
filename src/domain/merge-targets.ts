import type { RankedTarget } from "./models";

export function mergeRankedTargets(returned: RankedTarget[], saved: RankedTarget[]) {
  const returnedIds = new Set(returned.map((target) => target.id));
  const returnedDomains = new Set(returned.map((target) => target.domain).filter(Boolean));
  return [
    ...returned,
    ...saved.filter((target) => !returnedIds.has(target.id) && (!target.domain || !returnedDomains.has(target.domain))),
  ];
}
