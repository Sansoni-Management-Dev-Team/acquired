/** Public transport contracts. No application, framework, persistence or credential imports. */
export const COMMUNICATIONS_CONTRACT_VERSION = "1" as const;

export type Channel = "email" | "whatsapp" | "linkedin";
export type Platform = "gmail" | "outlook" | "imap" | "whatsapp" | "linkedin";
export type Backend = "direct" | "baileys" | "browser" | "unipile";

export interface AccessScope {
  applicationId: string;
  tenantId: string;
  ownerId: string;
}

/** Persist this snapshot on work before dispatch; defaults must never replace it. */
export interface ConnectionBinding extends AccessScope {
  connectionId: string;
  /** Service-owned stable account identity, not an unqualified provider account ID. */
  accountId: string;
  generation: number;
  channel: Channel;
  platform: Platform;
  backend: Backend;
}

export interface Capabilities {
  messaging: {
    send: boolean;
    /** Describes the authoritative journal, not presumed provider HTTP behavior. */
    durableIdempotency: boolean;
    receiptLookup: boolean;
  };
  events: { read: boolean; history: boolean; realtime: boolean };
  email?: { drafts: boolean; threading: boolean; rfcMessageId: boolean };
  linkedin?: { resolveProfile: boolean; relationships: boolean; invitations: boolean };
}

export type ConnectionStatus = "connecting" | "connected" | "syncing" | "verification_required" | "disconnected" | "failed";
export interface ConnectionRecord {
  binding: ConnectionBinding;
  status: ConnectionStatus;
  capabilities: Capabilities;
  providerAccountId?: string;
}

export type SetupAction =
  | { type: "redirect"; url: string; expiresAt: string }
  | { type: "qr"; value: string; expiresAt: string }
  | { type: "browser"; url: string; expiresAt?: string }
  | { type: "verification"; method: "code" | "approval"; expiresAt?: string }
  | { type: "complete"; connection: ConnectionRecord };

export type RetryCode = "incomplete" | "stale" | "busy" | "timeout" | "rate_limited" | "unavailable" | "identity_pending";
export type ReviewCode = "reconnect" | "account_changed" | "protocol" | "unexpected" | "delivery_disabled" | "unresolved_send" | "unsupported" | "forbidden" | "operation_conflict";
export type Readiness =
  | { status: "ready" }
  | { status: "waiting"; code: RetryCode; retryAt?: string }
  | { status: "review"; code: ReviewCode };

export interface CanonicalIdentity {
  kind: "email" | "phone" | "linkedin_profile";
  value: string;
}
export interface IdentityAlias {
  binding: ConnectionBinding;
  identity: CanonicalIdentity;
  namespace: string;
  value: string;
  verifiedAt: string;
}

export interface ProviderReference {
  /** IDs are meaningful only alongside the exact account/backend/generation. */
  binding: ConnectionBinding;
  id: string;
}
export interface MessageReceipt {
  message: ProviderReference;
  conversation?: ProviderReference;
  recipient: CanonicalIdentity;
  /** Unknown provider timestamps are absent, never replaced by lookup time. */
  submittedAt?: string;
  deliveredAt?: string;
  readAt?: string;
}

/** An accepted service action is not a provider message, delivery or read receipt. */
export interface ActionReceipt {
  operation: ProviderReference;
  recipient: CanonicalIdentity;
  submittedAt?: string;
}
export type SubmissionReceipt = MessageReceipt | ActionReceipt;

export type DeliveryOutcome =
  | { status: "submitted"; receipt: SubmissionReceipt }
  | { status: "skipped"; operation: ProviderReference; reason: string }
  | { status: "waiting"; code: RetryCode; retryAt?: string }
  | { status: "review"; code: ReviewCode }
  | { status: "unknown" }
  | { status: "rejected"; code: string };

/** Payload digest includes all content, recipient, threading, headers and operation options. */
export interface OperationSnapshot {
  key: string;
  binding: ConnectionBinding;
  operation: "message" | "invitation" | "draft_create" | "draft_update" | "draft_delete";
  payloadDigest: string;
}
export interface OutboundMessage {
  recipient: CanonicalIdentity;
  text: string;
  subject?: string;
  conversation?: ProviderReference;
  rfcMessageId?: string;
  /** Exact provider email parent plus approved full-content fingerprint. Server
   * derives it from verified history; it is not a model-selected thread ID. */
  replyParent?: {message:ProviderReference;contentDigest:string};
  replyTo?: string;
}
export interface MessageSubmission {
  snapshot: OperationSnapshot;
  message: OutboundMessage;
}
/** Lookup cannot carry dispatch content, and must not cause a new submission. */
export interface ReceiptLookup {
  snapshot: OperationSnapshot;
  message?: ProviderReference;
  /** Correlation metadata for direct-email recovery; never dispatch content. */
  rfcMessageId?: string;
  expectedRecipient?: CanonicalIdentity;
}

export interface Coverage {
  binding: ConnectionBinding;
  /** Exact query/identity scope; complete coverage of another scope is insufficient. */
  scope: string;
  from: string;
  through: string;
  observedAt: string;
  complete: boolean;
  initialSyncComplete: boolean;
  invalidated: boolean;
}
export type CommunicationEvent =
  | { type: "message"; reference: ProviderReference; conversation?: ProviderReference; direction: "inbound" | "outbound" | "self" | "group"; sender: CanonicalIdentity; occurredAt: string }
  | { type: "receipt"; receipt: MessageReceipt }
  | { type: "account"; binding: ConnectionBinding; status: ConnectionStatus; occurredAt: string }
  | { type: "email_change"; reference: ProviderReference; change: "folder"; occurredAt: string }
  | { type: "email_change"; reference: ProviderReference; change: "bounce"; recipient: CanonicalIdentity; occurredAt: string };
export interface EventCursor { binding: ConnectionBinding; scope: string; value: string }
export interface EventPage {
  events: CommunicationEvent[];
  nextCursor: EventCursor | null;
  coverage: Coverage;
  wait?: { code: RetryCode; retryAt?: string };
}
export interface EventQuery {
  binding: ConnectionBinding;
  scope: string;
  since: string;
  cursor: EventCursor | null;
  refresh: boolean;
}

export interface MessagingAdapter {
  ready(binding: ConnectionBinding): Promise<Readiness>;
  submit(input: MessageSubmission): Promise<DeliveryOutcome>;
  lookup(input: ReceiptLookup): Promise<DeliveryOutcome | null>;
}
export interface EventAdapter { read(input: EventQuery): Promise<EventPage> }
export interface DraftRecord {
  draft: ProviderReference;
  message?: ProviderReference;
  conversation?: ProviderReference;
}
export interface EmailDraftAdapter {
  create(input: MessageSubmission): Promise<DraftRecord>;
  update(input: MessageSubmission & { draft: ProviderReference }): Promise<DraftRecord>;
  delete(input: { snapshot: OperationSnapshot; draft: ProviderReference }): Promise<void>;
}
export type RelationshipStatus = "connected" | "invitation_pending" | "not_connected" | "unknown";
export interface LinkedinRelationshipAdapter {
  resolve(input: { binding: ConnectionBinding; profile: CanonicalIdentity }): Promise<{ identity: CanonicalIdentity; aliases: IdentityAlias[] }>;
  inspect(input: { binding: ConnectionBinding; profile: CanonicalIdentity; refresh: boolean }): Promise<{ status: RelationshipStatus; canMessage: boolean | null; observedAt: string }>;
  invite(input: MessageSubmission): Promise<DeliveryOutcome>;
}
export interface ConnectionAdapter {
  connect(input: AccessScope & { channel: Channel; platform: Platform; backend: Backend; state: string; redirectUrl: string }): Promise<SetupAction>;
  reconnect(input: { binding: ConnectionBinding; state: string; redirectUrl: string }): Promise<SetupAction>;
  disconnect(binding: ConnectionBinding): Promise<void>;
  status(binding: ConnectionBinding): Promise<ConnectionRecord>;
}

export type ContractErrorCode = "forbidden" | "binding_changed" | "connection_unavailable" | "operation_conflict" | "invalid_binding" | "receipt_mismatch";
export class ContractError extends Error {
  constructor(public readonly code: ContractErrorCode) {
    super(code);
    this.name = "ContractError";
  }
}

const scopeFields = ["applicationId", "tenantId", "ownerId"] as const;
const bindingFields = [...scopeFields, "connectionId", "accountId", "generation", "channel", "platform", "backend"] as const;
const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

function validateBinding(binding: ConnectionBinding): void {
  if (!binding || !bindingFields.every(field => field === "generation" || nonempty(binding[field])) ||
      !Number.isSafeInteger(binding.generation) || binding.generation < 1) {
    throw new ContractError("invalid_binding");
  }
  const platformChannel: Record<Platform, Channel> = {
    gmail: "email", outlook: "email", imap: "email", whatsapp: "whatsapp", linkedin: "linkedin",
  };
  const backendChannels: Record<Backend, readonly Channel[]> = {
    direct: ["email"], baileys: ["whatsapp"], browser: ["linkedin"], unipile: ["email", "whatsapp", "linkedin"],
  };
  if (platformChannel[binding.platform] !== binding.channel ||
      !backendChannels[binding.backend]?.includes(binding.channel)) {
    throw new ContractError("invalid_binding");
  }
}

export function assertSameBinding(expected: ConnectionBinding, actual: ConnectionBinding): void {
  validateBinding(expected);
  validateBinding(actual);
  if (!bindingFields.every(field => expected[field] === actual[field])) {
    throw new ContractError("binding_changed");
  }
}

/** Resolution is deliberately independent of readiness so receipt lookup can recover disconnected work. */
export function resolveRecordedConnection(
  scope: AccessScope,
  recorded: ConnectionBinding,
  connections: readonly ConnectionRecord[],
): ConnectionRecord {
  validateBinding(recorded);
  if (!scope || !scopeFields.every(field => nonempty(scope[field]) && scope[field] === recorded[field])) {
    throw new ContractError("forbidden");
  }
  const candidates = connections.filter(connection => connection.binding.connectionId === recorded.connectionId);
  if (candidates.length !== 1) throw new ContractError("connection_unavailable");
  assertSameBinding(recorded, candidates[0].binding);
  return candidates[0];
}

export function assertOperationMatches(recorded: OperationSnapshot, requested: OperationSnapshot): void {
  try {
    assertSameBinding(recorded.binding, requested.binding);
  } catch {
    throw new ContractError("operation_conflict");
  }
  if (!nonempty(recorded.key) || !nonempty(recorded.payloadDigest) ||
      recorded.key !== requested.key || recorded.operation !== requested.operation ||
      recorded.payloadDigest !== requested.payloadDigest) {
    throw new ContractError("operation_conflict");
  }
}

export function assertReceiptMatches(
  snapshot: OperationSnapshot,
  recipient: CanonicalIdentity,
  receipt: MessageReceipt,
): void {
  try {
    if ("operation" in receipt) throw new ContractError("receipt_mismatch");
    assertSameBinding(snapshot.binding, receipt.message.binding);
    if (receipt.conversation) assertSameBinding(snapshot.binding, receipt.conversation.binding);
    if (!nonempty(receipt.message.id) || (receipt.conversation && !nonempty(receipt.conversation.id)) ||
        !nonempty(recipient.value) || receipt.recipient.kind !== recipient.kind ||
        receipt.recipient.value !== recipient.value) throw new ContractError("receipt_mismatch");
  } catch {
    throw new ContractError("receipt_mismatch");
  }
}

export function assertActionReceiptMatches(
  snapshot: OperationSnapshot,
  recipient: CanonicalIdentity,
  receipt: ActionReceipt,
): void {
  try {
    if ("message" in receipt || "conversation" in receipt || "deliveredAt" in receipt || "readAt" in receipt) {
      throw new ContractError("receipt_mismatch");
    }
    assertSameBinding(snapshot.binding, receipt.operation.binding);
    if (!nonempty(receipt.operation.id) || !nonempty(recipient.value) ||
        receipt.recipient.kind !== recipient.kind || receipt.recipient.value !== recipient.value) {
      throw new ContractError("receipt_mismatch");
    }
  } catch { throw new ContractError("receipt_mismatch"); }
}

export function assertSubmissionReceiptMatches(
  snapshot: OperationSnapshot,
  recipient: CanonicalIdentity,
  receipt: SubmissionReceipt,
): void {
  if (receipt && "message" in receipt) return assertReceiptMatches(snapshot, recipient, receipt);
  if (receipt && "operation" in receipt) return assertActionReceiptMatches(snapshot, recipient, receipt);
  throw new ContractError("receipt_mismatch");
}

/** Adapter evidence, not transport success, determines whether historical coverage is fresh. */
export function coverageReady(
  query: Pick<EventQuery, "binding" | "scope" | "since">,
  coverage: Coverage,
  now: number,
  maxAgeMs = 300_000,
): boolean {
  try { assertSameBinding(query.binding, coverage.binding); } catch { return false; }
  if (!Number.isFinite(now) || !Number.isFinite(maxAgeMs) || maxAgeMs < 0 ||
      !nonempty(query.scope) || query.scope !== coverage.scope || !coverage.complete ||
      !coverage.initialSyncComplete || coverage.invalidated) return false;
  const from = Date.parse(coverage.from);
  const through = Date.parse(coverage.through);
  const observedAt = Date.parse(coverage.observedAt);
  const since = Date.parse(query.since);
  if (![from, through, observedAt, since].every(Number.isFinite)) return false;
  return from <= since && since <= through && through <= observedAt && observedAt <= now &&
    now - through <= maxAgeMs && now - observedAt <= maxAgeMs;
}
