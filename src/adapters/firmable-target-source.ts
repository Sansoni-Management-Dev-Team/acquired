import type { TargetCandidate } from "@/domain/models";
import type { TargetSource, TargetSourceCapabilities } from "./target-source";

/**
 * Firmable is intentionally enrichment-only until the account's search capability is confirmed.
 * Mapping vendor data into TargetCandidate belongs here, including personal-data fictionalisation.
 */
export class FirmableTargetSource implements TargetSource {
  readonly name = "Firmable";

  async search(): Promise<TargetCandidate[]> {
    throw new Error("Firmable search is not enabled: use a register source for discovery");
  }

  async enrich(): Promise<TargetCandidate> {
    throw new Error("Firmable enrichment is not configured");
  }

  capabilities(): TargetSourceCapabilities {
    return { canSearch: false, canEnrich: true, coverage: "Australian companies and people; plan-dependent" };
  }
}
