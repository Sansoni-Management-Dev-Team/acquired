import { describe, expect, it, vi } from "vitest";
import type { ConnectionBinding, ConnectionRecord, MessageSubmission, OperationSnapshot } from "../../contracts/src/index";
import { messageDigest } from "../../core/src/message-digest";
import { createLegacyMessagingAdapter, type LegacyDeliveryPort } from "./index";

const binding: ConnectionBinding = {
  applicationId: "review-app", tenantId: "review-tenant", ownerId: "review-owner",
  connectionId: "review-whatsapp", accountId: "review-account", generation: 1,
  channel: "whatsapp", platform: "whatsapp", backend: "baileys",
};
const record: ConnectionRecord = {
  binding, status: "connected",
  capabilities: { messaging: { send: true, durableIdempotency: true, receiptLookup: true }, events: { read: false, history: false, realtime: false } },
};
const message: MessageSubmission["message"] = { recipient: { kind: "phone", value: "+61400000003" }, text: "Review fixture" };
const snapshot: OperationSnapshot = { binding, key: "review-operation", operation: "message", payloadDigest: messageDigest("message", message) };
function port(): LegacyDeliveryPort {
  return {
    ready: vi.fn().mockResolvedValue({ status: "ready" }),
    submit: vi.fn().mockResolvedValue({ status: "submitted", id: "message" }),
    lookup: vi.fn().mockResolvedValue({ status: "submitted", id: "different-message" }),
  };
}

describe("independent legacy wrapper review", () => {
  it("rejects a recovered message ID that differs from the recorded provider reference (A08)", async () => {
    const transport = port();
    const adapter = createLegacyMessagingAdapter(record, transport);
    await expect(adapter.lookup({ snapshot, message: { binding, id: "recorded-message" }, expectedRecipient: message.recipient })).rejects.toThrow("receipt_mismatch");
    expect(transport.submit).not.toHaveBeenCalled();
  });
  it.each(["draft_create", "draft_update", "draft_delete"] as const)("does not use messaging lookup to recover %s (P1.2/A17)", async operation => {
    const transport = port();
    const result = await createLegacyMessagingAdapter(record, transport).lookup({ snapshot: { ...snapshot, operation }, expectedRecipient: message.recipient });
    expect(result).toEqual({ status: "review", code: "unsupported" });
    expect(transport.lookup).not.toHaveBeenCalled();
    expect(transport.submit).not.toHaveBeenCalled();
  });
  it("does not grant a WhatsApp invitation operation from mismatched LinkedIn capabilities", async () => {
    const transport = port();
    const inconsistent: ConnectionRecord = { ...record, capabilities: { ...record.capabilities, linkedin: { invitations: true, relationships: true, resolveProfile: true } } };
    const result = await createLegacyMessagingAdapter(inconsistent, transport).submit({ snapshot: { ...snapshot, operation: "invitation", payloadDigest: messageDigest("invitation", message) }, message });
    expect(result).toEqual({ status: "review", code: "unsupported" });
    expect(transport.submit).not.toHaveBeenCalled();
  });
  it("retains the original configured submit port across asynchronous readiness", async () => {
    const transport = port();
    const originalSubmit = transport.submit;
    const replacementSubmit = vi.fn().mockResolvedValue({ status: "submitted", id: "other-account-message" });
    vi.mocked(transport.ready).mockImplementation(async () => {
      transport.submit = replacementSubmit;
      return { status: "ready" };
    });
    await createLegacyMessagingAdapter(record, transport).submit({ snapshot, message });
    expect(originalSubmit).toHaveBeenCalledTimes(1);
    expect(replacementSubmit).not.toHaveBeenCalled();
  });
});
