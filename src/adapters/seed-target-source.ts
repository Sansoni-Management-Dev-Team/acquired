import type { TargetSource, TargetSourceCapabilities } from "./target-source";
import { seedTargets } from "@/data/seed-targets";
import type { TargetCandidate } from "@/domain/models";

export class SeedTargetSource implements TargetSource {
  readonly name = "Synthetic register";

  async search() { return seedTargets; }

  async enrich(identifier: string): Promise<TargetCandidate> {
    const target = seedTargets.find((item) => item.id === identifier || item.domain === identifier);
    if (!target) throw new Error(`Synthetic target not found: ${identifier}`);
    return target;
  }

  capabilities(): TargetSourceCapabilities {
    return { canSearch: true, canEnrich: true, coverage: "Synthetic AU mechanical-services dataset" };
  }
}
