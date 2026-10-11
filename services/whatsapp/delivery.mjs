import { jidNormalizedUser } from "@whiskeysockets/baileys";
export async function submitDelivery(auth, socket, account, input) {
  const fingerprint = auth.deliveryFingerprint(input);
  // Commit the claim before touching the external provider. A crash leaves an
  // unresolved action, which is never automatically resubmitted.
  const claim = await auth.claimDelivery(account, input.key, fingerprint);
  if (claim.status !== "claimed") return claim;
  try {
    const sent = await socket.sendMessage(input.recipient, {
      text: input.text,
    });
    if (
      typeof sent?.key?.id !== "string" ||
      !sent.key.id ||
      typeof sent.key.remoteJid !== "string"
    )
      throw Error("Missing submission receipt");
    const remote = jidNormalizedUser(sent.key.remoteJid);
    const phone = remote.endsWith("@lid")
      ? await socket.signalRepository?.lidMapping?.getPNForLID(remote)
      : remote;
    if (!phone || jidNormalizedUser(phone) !== input.recipient)
      throw Error("Unverified receipt recipient");
    const result = {
      status: "submitted",
      id: sent.key.id,
      recipient: sent.key.remoteJid,
      sentAt: new Date().toISOString(),
    };
    await auth.completeDelivery(input.key, result);
    return result;
  } catch {
    await auth.markDeliveryUnknown(input.key).catch(() => {});
    return { status: "unknown" };
  }
}
