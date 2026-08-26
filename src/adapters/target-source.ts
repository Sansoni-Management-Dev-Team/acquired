import type { Mandate, TargetCandidate } from "@/domain/models";

export type TargetSourceCapabilities = {
  canSearch: boolean;
  canEnrich: boolean;
  coverage: string;
  costPerCall?: string;
};

export interface TargetSource {
  readonly name: string;
  search(mandate: Mandate): Promise<TargetCandidate[]>;
  enrich(identifier: string): Promise<TargetCandidate>;
  capabilities(): TargetSourceCapabilities;
}
