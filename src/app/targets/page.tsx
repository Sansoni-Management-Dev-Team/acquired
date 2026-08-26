import { SeedTargetSource } from "@/adapters/seed-target-source";
import type { TargetSource } from "@/adapters/target-source";
import { TargetsDashboard } from "@/components/targets-dashboard";
import { defaultMandate } from "@/data/seed-targets";
import { rankTargets } from "@/domain/scoring";

export default async function TargetsPage() {
  const source: TargetSource = new SeedTargetSource();
  const candidates = await source.search(defaultMandate);
  return <TargetsDashboard targets={rankTargets(candidates, defaultMandate)} />;
}
