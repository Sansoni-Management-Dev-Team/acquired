import { expect, it, vi } from "vitest";
import { verifyCampaignReplyRollout } from "./campaign-rollout-readiness.mjs";
it("does not read providers with reply enforcement disabled", async () => {
  const read = vi.fn(); await verifyCampaignReplyRollout("observe", [{ organizationId: "org", userId: "owner" }], read); expect(read).not.toHaveBeenCalled();
});
it.each([{ enforceReady: false, mode: "enforce" }, { enforceReady: true, mode: "observe" }, { enforceReady: true, mode: "enforce", truncated: true }])("rejects an unready enforcement rollout %#", async report => {
  await expect(verifyCampaignReplyRollout("enforce", [{ organizationId: "org", userId: "owner" }], vi.fn().mockResolvedValue(report))).rejects.toThrow();
});
it("accepts scoped coverage or explicit waiting without requiring live delivery", async () => {
  await expect(verifyCampaignReplyRollout("enforce", [{ organizationId: "org", userId: "owner" }], vi.fn().mockResolvedValue({ enforceReady: true, recoveryReady: false, mode: "enforce", truncated: false }))).resolves.toBeUndefined();
});
