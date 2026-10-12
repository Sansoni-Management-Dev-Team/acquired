import type {
  Capabilities, ConnectionBinding, DeliveryOutcome, EmailDraftAdapter, MessagingAdapter,
  DraftRecord, MessageSubmission, OperationSnapshot, OutboundMessage, ProviderReference, Readiness,
} from "../../contracts/src/index";
import { assertOperationMatches, assertReceiptMatches, assertSameBinding, ContractError } from "../../contracts/src/index";

export interface GmailMessage {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
  threadId?: string;
  messageId?: string;
}
export interface GmailDelivery { providerMessageId: string; providerThreadId?: string; sentAt?: Date }
export interface GmailLookupReceipt { id: string; threadId?: string; sentAt?: Date }
export interface GmailSavedDraft { providerDraftId: string; providerMessageId?: string; providerThreadId?: string }
export interface GmailMailboxPort {
  send(ownerId: string, message: GmailMessage): Promise<GmailDelivery>;
  findByRfcMessageId(messageId: string): Promise<GmailLookupReceipt | null>;
  findByMessageId?(messageId: string): Promise<GmailLookupReceipt | null>;
}
export interface GmailDraftPort {
  createDraft(ownerId: string, message: GmailMessage): Promise<GmailSavedDraft>;
  updateDraft(draftId: string, message: GmailMessage): Promise<GmailSavedDraft>;
  deleteDraft(draftId: string): Promise<void>;
}
export interface GmailAdapterOptions {
  binding: ConnectionBinding;
  mailbox: GmailMailboxPort;
  drafts?: GmailDraftPort;
  readiness: (binding: ConnectionBinding) => Promise<Readiness>;
  /** Use the service core's canonical digest helper; injection keeps this port independent. */
  messageDigest: (operation: OperationSnapshot["operation"], message: OutboundMessage) => string;
  draftDigest?: (operation: "draft_update" | "draft_delete", draft: ProviderReference, message?: OutboundMessage) => string;
  /** Only return waiting/review/rejected when non-acceptance is definite. */
  classifyFailure?: (error: unknown) => Extract<DeliveryOutcome, { status: "waiting" | "review" | "rejected" }> | undefined;
}
export interface GmailAdapter extends MessagingAdapter {
  binding: ConnectionBinding;
  capabilities: Capabilities;
  drafts?: EmailDraftAdapter;
}

const present = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

function emailRecipient(recipient: OutboundMessage["recipient"]): OutboundMessage["recipient"] {
  const value = recipient.value.trim().toLowerCase();
  if (recipient.kind !== "email" || !/^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(value)) {
    throw new ContractError("operation_conflict");
  }
  return { kind: "email", value };
}

function legacyMessage(message: OutboundMessage): GmailMessage {
  return {
    to: emailRecipient(message.recipient).value,
    subject: message.subject ?? "", text: message.text,
    ...(message.replyTo !== undefined ? { replyTo: message.replyTo } : {}),
    ...(message.conversation ? { threadId: message.conversation.id } : {}),
    ...(message.rfcMessageId !== undefined ? { messageId: message.rfcMessageId } : {}),
  };
}

/** Adds the shared boundary to an existing mailbox; it does not move OAuth or create a journal. */
export function createGmailAdapter(options: GmailAdapterOptions): GmailAdapter {
  // Capture configured ports and callbacks, including method receivers, once per binding.
  const mailbox = options.mailbox;
  const drafts = options.drafts;
  options = {
    ...options,
    mailbox: {
      send: mailbox.send.bind(mailbox),
      findByRfcMessageId: mailbox.findByRfcMessageId.bind(mailbox),
      ...(mailbox.findByMessageId ? { findByMessageId: mailbox.findByMessageId.bind(mailbox) } : {}),
    },
    ...(drafts ? { drafts: {
      createDraft: drafts.createDraft.bind(drafts),
      updateDraft: drafts.updateDraft.bind(drafts),
      deleteDraft: drafts.deleteDraft.bind(drafts),
    } } : {}),
  };
  const binding = Object.freeze({ ...options.binding });
  assertSameBinding(binding, binding);
  if (binding.channel !== "email" || binding.platform !== "gmail" || binding.backend !== "direct") {
    throw new ContractError("invalid_binding");
  }
  if (options.drafts && !options.draftDigest) throw new ContractError("operation_conflict");
  const reference = (id: string): ProviderReference => {
    if (!present(id)) throw new ContractError("receipt_mismatch");
    return { binding, id };
  };
  const assertReference = (value: ProviderReference): void => {
    assertSameBinding(binding, value.binding);
    if (!present(value.id)) throw new ContractError("operation_conflict");
  };
  const assertSnapshot = (snapshot: OperationSnapshot, operation: OperationSnapshot["operation"]): void => {
    assertSameBinding(binding, snapshot.binding);
    assertOperationMatches({ ...snapshot, binding, operation }, snapshot);
  };
  const assertMessage = (input: MessageSubmission, operation: OperationSnapshot["operation"], digest?: string): void => {
    assertSnapshot(input.snapshot, operation);
    if (input.message.conversation) assertReference(input.message.conversation);
    emailRecipient(input.message.recipient);
    assertOperationMatches({ ...input.snapshot, payloadDigest: digest ?? options.messageDigest(operation, input.message) }, input.snapshot);
  };
  const ensureReady = async (): Promise<void> => {
    const readiness = await options.readiness(binding);
    if (readiness.status !== "ready") throw new GmailReadinessError(readiness);
  };
  const draftRecord = (saved: GmailSavedDraft): DraftRecord => ({
    draft: reference(saved.providerDraftId),
    ...(saved.providerMessageId !== undefined ? { message: reference(saved.providerMessageId) } : {}),
    ...(saved.providerThreadId !== undefined ? { conversation: reference(saved.providerThreadId) } : {}),
  });

  const adapter: GmailAdapter = {
    binding,
    capabilities: {
      messaging: { send: true, durableIdempotency: false, receiptLookup: true },
      events: { read: false, history: false, realtime: false },
      email: { drafts: Boolean(options.drafts), threading: true, rfcMessageId: true },
    },
    async ready(recorded) {
      assertSameBinding(binding, recorded);
      return options.readiness(binding);
    },
    async submit(request) {
      // Freeze the payload used for validation before readiness awaits can yield to callers.
      const input = structuredClone(request);
      assertMessage(input, "message");
      const readiness = await options.readiness(binding);
      if (readiness.status !== "ready") return readiness;
      let delivered: GmailDelivery;
      try { delivered = await options.mailbox.send(binding.ownerId, legacyMessage(input.message)); }
      catch (error) { return options.classifyFailure?.(error) ?? { status: "unknown" }; }
      try {
        if (input.message.conversation && input.message.conversation.id !== delivered.providerThreadId) {
          return { status: "unknown" };
        }
        const recipient = emailRecipient(input.message.recipient);
        const receipt = {
          message: reference(delivered.providerMessageId), recipient,
          ...(delivered.providerThreadId !== undefined ? { conversation: reference(delivered.providerThreadId) } : {}),
          ...(delivered.sentAt !== undefined ? { submittedAt: delivered.sentAt.toISOString() } : {}),
        };
        assertReceiptMatches(input.snapshot, recipient, receipt);
        return { status: "submitted", receipt };
      } catch { return { status: "unknown" }; }
    },
    async lookup(request) {
      const input = structuredClone(request);
      assertSnapshot(input.snapshot, "message");
      if (input.message) assertReference(input.message);
      if (!input.expectedRecipient) return null;
      const recipient = emailRecipient(input.expectedRecipient);
      let found: GmailLookupReceipt | null;
      if (input.message && options.mailbox.findByMessageId) {
        found = await options.mailbox.findByMessageId(input.message.id);
      } else if (present(input.rfcMessageId)) {
        found = await options.mailbox.findByRfcMessageId(input.rfcMessageId);
      } else return null;
      if (!found) return null;
      if (input.message && input.message.id !== found.id) throw new ContractError("receipt_mismatch");
      const receipt = {
        message: reference(found.id), recipient,
        ...(found.threadId !== undefined ? { conversation: reference(found.threadId) } : {}),
        ...(found.sentAt !== undefined ? { submittedAt: found.sentAt.toISOString() } : {}),
      };
      assertReceiptMatches(input.snapshot, recipient, receipt);
      return { status: "submitted", receipt };
    },
  };
  if (options.drafts) {
    const drafts = options.drafts;
    adapter.drafts = {
      async create(request) {
        const input = structuredClone(request);
        assertMessage(input, "draft_create");
        await ensureReady();
        return draftRecord(await drafts.createDraft(binding.ownerId, legacyMessage(input.message)));
      },
      async update(request) {
        const input = structuredClone(request);
        assertReference(input.draft);
        assertMessage(input, "draft_update", options.draftDigest!("draft_update", input.draft, input.message));
        await ensureReady();
        const result = await drafts.updateDraft(input.draft.id, legacyMessage(input.message));
        if (result.providerDraftId !== input.draft.id) throw new ContractError("receipt_mismatch");
        return draftRecord(result);
      },
      async delete(request) {
        const input = structuredClone(request);
        assertReference(input.draft);
        assertSnapshot(input.snapshot, "draft_delete");
        assertOperationMatches({ ...input.snapshot, payloadDigest: options.draftDigest!("draft_delete", input.draft) }, input.snapshot);
        await ensureReady();
        await drafts.deleteDraft(input.draft.id);
      },
    };
  }
  return adapter;
}

/** Draft-only operations have no delivery outcome; surface account-readiness failures explicitly. */
export class GmailReadinessError extends Error {
  constructor(public readonly readiness: Exclude<Readiness, { status: "ready" }>) {
    super(readiness.code);
    this.name = "GmailReadinessError";
  }
}
