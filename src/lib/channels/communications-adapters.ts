import "server-only";
import type { CampaignActor } from "@/db/campaign-client";
import type { CampaignMailbox } from "@/lib/campaign-mailbox";
import { GmailSendRejected } from "@/adapters/gmail-errors";
import { replyCheckFailure, ReplyCheckPending } from "@/lib/campaign-reply-status";
import { createGmailAdapter, type GmailDraftPort } from "../../../communications/packages/adapter-gmail/src/index";
import { createLegacyMessagingAdapter } from "../../../communications/packages/adapter-legacy/src/index";
import { ContractError, resolveRecordedConnection, type ConnectionRecord, type MessagingAdapter, type Readiness } from "../../../communications/packages/contracts/src/index";
import { draftDigest, messageDigest } from "../../../communications/packages/core/src/message-digest";
import { deliveryProvider } from "./delivery-registry";

/** Acquire-only composition root. The injected mailbox must come from the owner's verified grant. */
export function acquireLegacyAdapter(actor: CampaignActor, connection: ConnectionRecord, mailbox?: CampaignMailbox, drafts?: GmailDraftPort): MessagingAdapter {
  const owner = { ...actor };
  const record = structuredClone(resolveRecordedConnection({ applicationId: "acquire", tenantId: owner.organizationId, ownerId: owner.userId }, connection.binding, [connection]));
  const legacyBackends = { email: "direct", whatsapp: "baileys", linkedin: "browser" } as const;
  if (record.binding.backend !== legacyBackends[record.binding.channel]) throw new ContractError("invalid_binding");
  const provider = deliveryProvider(record.binding.channel, mailbox);
  const failure = (error: unknown): Exclude<Readiness, { status: "ready" }> => {
    const classified = replyCheckFailure(error, record.binding.channel);
    return classified instanceof ReplyCheckPending
      ? { status: "waiting", code: classified.code, retryAt: classified.retryAt.toISOString() }
      : { status: "review", code: classified.code };
  };
  const ready = async (): Promise<Readiness> => {
    if (!record.capabilities.messaging.send) return { status: "review", code: "delivery_disabled" };
    if (["connecting", "syncing"].includes(record.status)) return { status: "waiting", code: "incomplete" };
    if (record.status !== "connected") return { status: "review", code: "reconnect" };
    try { await provider.ready(owner); return { status: "ready" }; }
    catch (error) { return failure(error); }
  };
  if (record.binding.channel === "email" && mailbox) {
    return createGmailAdapter({
      binding: record.binding, mailbox, drafts, readiness: ready, messageDigest, draftDigest,
      classifyFailure: error => error instanceof GmailSendRejected ? failure(error.failure) : undefined,
    });
  }
  return createLegacyMessagingAdapter(record, {
    ready,
    submit: input => provider.submit({ ...input, actor: owner }),
    lookup: input => provider.lookup({ ...input, actor: owner }),
  });
}
