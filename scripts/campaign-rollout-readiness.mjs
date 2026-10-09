export async function verifyCampaignReplyRollout(mode, actors, read) {
  if (mode !== "enforce") return;
  if (actors.length > 100) throw new Error("Campaign rollout scope exceeds the bounded readiness check");
  for (const actor of actors) {
    const report = await read(actor);
    if (report.mode !== "enforce" || !report.enforceReady || report.truncated)
      throw new Error("Campaign enforcement requires scoped coverage or explicit waiting before rollout");
  }
}
