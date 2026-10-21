import { recoverMandateResearch } from './research-maintenance';

// Recovery is independent of the progress payload and runs at a slower cadence.
export async function recoverCompanyListWork(org: string, mandateId: string, now = Date.now()) {
  return recoverMandateResearch(org, mandateId, now);
}
