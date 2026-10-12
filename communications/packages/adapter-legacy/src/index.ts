import {
  assertSameBinding,
  ContractError,
  type CanonicalIdentity,
  type ConnectionBinding,
  type ConnectionRecord,
  type DeliveryOutcome,
  type MessageSubmission,
  type MessagingAdapter,
  type OperationSnapshot,
} from "../../contracts/src/index";
import { messageDigest } from "../../core/src/message-digest";

export type LegacyOutcome =
  | { status: "submitted" | "skipped"; id: string; sentAt?: string; threadId?: string }
  | Extract<DeliveryOutcome, { status: "waiting" | "review" | "unknown" }>;
export interface LegacyDeliveryPort {
  ready(): Promise<import("../../contracts/src/index").Readiness>;
  submit(input: { key: string; recipient: string; text: string; subject?: string; messageId?: string; operation: "message" | "connect" }): Promise<LegacyOutcome>;
  lookup(input: { key: string; messageId?: string }): Promise<LegacyOutcome | null>;
}
function recipientFor(binding: ConnectionBinding, identity: CanonicalIdentity): string {
  if (binding.channel === "email" && identity.kind === "email" && /^[^\s<>@]+@[^\s<>@]+$/.test(identity.value)) return identity.value;
  if (binding.channel === "whatsapp" && identity.kind === "phone" && /^\+[1-9]\d{6,14}$/.test(identity.value)) return `${identity.value.slice(1)}@s.whatsapp.net`;
  if (binding.channel === "linkedin" && identity.kind === "linkedin_profile") {
    const url = new URL(identity.value);
    if (url.protocol === "https:" && ["linkedin.com", "www.linkedin.com"].includes(url.hostname) && /^\/in\/[^/]+\/?$/.test(url.pathname) && !url.username && !url.password && !url.search && !url.hash && !url.port) return url.href;
  }
  throw new ContractError("operation_conflict");
}

function assertSnapshot(binding: ConnectionBinding, snapshot: OperationSnapshot): void {
  assertSameBinding(binding, snapshot.binding);
  if (!snapshot.key.trim() || snapshot.key.length > 200 || !/^[a-f0-9]{64}$/.test(snapshot.payloadDigest)) throw new ContractError("operation_conflict");
}

function normalize(outcome: LegacyOutcome, binding: ConnectionBinding, recipient?: CanonicalIdentity, lookup = false): DeliveryOutcome {
  const receiptBinding = structuredClone(binding);
  if (outcome.status === "skipped") return outcome.id ? { status: "skipped", operation: { binding: receiptBinding, id: outcome.id }, reason: "legacy_operation_skipped" } : { status: "unknown" };
  if (outcome.status === "submitted") {
    if (!outcome.id || !recipient) return lookup && !recipient ? { status: "review", code: "protocol" } : { status: "unknown" };
    if (binding.backend === "browser") {
      return {
        status: "submitted",
        receipt: {
          operation: { binding: receiptBinding, id: outcome.id }, recipient: { ...recipient },
          ...(!lookup && outcome.sentAt && Number.isFinite(Date.parse(outcome.sentAt)) ? { submittedAt: outcome.sentAt } : {}),
        },
      };
    }
    return {
      status: "submitted",
      receipt: {
        message: { binding: receiptBinding, id: outcome.id },
        recipient: { ...recipient },
        ...(outcome.threadId ? { conversation: { binding: structuredClone(binding), id: outcome.threadId } } : {}),
        // Some legacy lookup implementations report the current lookup time.
        // Omit it: it cannot establish when the original submission happened.
        ...(!lookup && outcome.sentAt && Number.isFinite(Date.parse(outcome.sentAt)) ? { submittedAt: outcome.sentAt } : {}),
      },
    };
  }
  if (["waiting", "review", "unknown"].includes(outcome.status)) return outcome as DeliveryOutcome;
  return { status: "unknown" };
}

/** The injected legacy service remains authoritative for leases, quotas and journals. */
export function createLegacyMessagingAdapter(connection: ConnectionRecord, port: LegacyDeliveryPort): MessagingAdapter {
  assertSameBinding(connection.binding, connection.binding);
  if (connection.binding.backend === "unipile") throw new ContractError("invalid_binding");
  const binding = structuredClone(connection.binding);
  const capabilities = structuredClone(connection.capabilities);
  const status = connection.status;
  const portReady = port.ready.bind(port);
  const portSubmit = port.submit.bind(port);
  const portLookup = port.lookup.bind(port);
  const ready: MessagingAdapter["ready"] = async requested => {
    assertSameBinding(binding, requested);
    if (!capabilities.messaging.send) return { status: "review", code: "delivery_disabled" };
    if (["connecting", "syncing"].includes(status)) return { status: "waiting", code: "incomplete" };
    if (status !== "connected") return { status: "review", code: "reconnect" };
    return portReady();
  };
  return {
    ready,
    async submit(request: MessageSubmission) {
      const input = structuredClone(request);
      assertSnapshot(binding, input.snapshot);
      if (input.message.conversation) assertSameBinding(binding, input.message.conversation.binding);
      if (messageDigest(input.snapshot.operation, input.message) !== input.snapshot.payloadDigest) throw new ContractError("operation_conflict");
      const recipient = recipientFor(binding, input.message.recipient);
      const invitation = input.snapshot.operation === "invitation";
      if ((!invitation && input.snapshot.operation !== "message") || (invitation && (binding.channel !== "linkedin" || !capabilities.linkedin?.invitations)) || input.message.conversation || input.message.replyTo ||
          (binding.channel !== "email" && (input.message.subject !== undefined || input.message.rfcMessageId !== undefined))) return { status: "review", code: "unsupported" };
      const readiness = await ready(input.snapshot.binding);
      if (readiness.status !== "ready") return readiness;
      try {
        const result = await portSubmit({
          key: input.snapshot.key, recipient, text: input.message.text,
          operation: invitation ? "connect" : "message",
          ...(input.message.subject !== undefined ? { subject: input.message.subject } : {}),
          ...(input.message.rfcMessageId ? { messageId: input.message.rfcMessageId } : {}),
        });
        return normalize(result, binding, input.message.recipient);
      } catch {
        // A thrown dispatch can follow acceptance. Never classify it as an unsent retry.
        return { status: "unknown" };
      }
    },
    async lookup(request) {
      const input = structuredClone(request);
      assertSnapshot(binding, input.snapshot);
      if (input.message) assertSameBinding(binding, input.message.binding);
      if (input.expectedRecipient) recipientFor(binding, input.expectedRecipient);
      if (!["message", "invitation"].includes(input.snapshot.operation) || (input.snapshot.operation === "invitation" && binding.channel !== "linkedin")) return { status: "review", code: "unsupported" };
      if (!capabilities.messaging.receiptLookup) return { status: "review", code: "unsupported" };
      const result = await portLookup({ key: input.snapshot.key, ...(input.rfcMessageId ? { messageId: input.rfcMessageId } : {}) });
      if (result && (result.status === "submitted" || result.status === "skipped") && input.message && input.message.id !== result.id) throw new ContractError("receipt_mismatch");
      return result ? normalize(result, binding, input.expectedRecipient, true) : null;
    },
  };
}
