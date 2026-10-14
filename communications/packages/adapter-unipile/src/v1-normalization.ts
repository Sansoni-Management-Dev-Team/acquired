import { assertSameBinding } from "../../contracts/src";
import type { CanonicalIdentity, ConnectionBinding, DeliveryOutcome, MessageSubmission, OperationSnapshot, ProviderReference, Readiness, ReceiptLookup } from "../../contracts/src";

export interface V1AccountExpectation { binding: ConnectionBinding; providerAccountId: string; sourceId: string }
export interface V1MessageExpectation { lookup: ReceiptLookup; providerAccountId: string; conversation: ProviderReference; recipient: CanonicalIdentity }

const unknown = (): DeliveryOutcome => ({ status: "unknown" });
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const identifier = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.trim() === value;
// Match the v1 transport's addressability limits while retaining opaque slash/percent IDs.
const addressableId = (value: unknown): value is string => identifier(value) && value.length <= 2048 &&
  value !== "." && value !== ".." && !/[\u0000-\u001f\u007f]/.test(value);
const accountTypes = { gmail: "GOOGLE_OAUTH", outlook: "OUTLOOK", imap: "MAIL", whatsapp: "WHATSAPP", linkedin: "LINKEDIN" } as const;

function unipileBinding(binding: ConnectionBinding): boolean {
  try { assertSameBinding(binding, binding); return binding.backend === "unipile"; } catch { return false; }
}
function matchesReference(binding: ConnectionBinding, reference: ProviderReference | undefined): reference is ProviderReference {
  if (!reference || !addressableId(reference.id)) return false;
  try { assertSameBinding(binding, reference.binding); return true; } catch { return false; }
}
function validOperation(snapshot: OperationSnapshot, operation: "message" | "invitation"): boolean {
  return !!snapshot && unipileBinding(snapshot.binding) && snapshot.operation === operation && identifier(snapshot.key) && identifier(snapshot.payloadDigest);
}
function socialRecipient(binding: ConnectionBinding, recipient: CanonicalIdentity): boolean {
  return !!recipient && identifier(recipient.value) &&
    ((binding.channel === "whatsapp" && recipient.kind === "phone") ||
     (binding.channel === "linkedin" && recipient.kind === "linkedin_profile"));
}

/** Source IDs are opaque in v1's schema. The service must explicitly configure its relevant source ID.
 * An OK account source is transport health only: it does not prove reply coverage or capabilities. */
export function normalizeV1AccountReadiness(raw: unknown, expected: V1AccountExpectation): Readiness {
  if (!expected || !unipileBinding(expected.binding) || !addressableId(expected.providerAccountId) || !identifier(expected.sourceId) ||
      !object(raw) || raw.object !== "Account") return { status: "review", code: "protocol" };
  if (raw.id !== expected.providerAccountId || raw.type !== accountTypes[expected.binding.platform]) {
    return { status: "review", code: "account_changed" };
  }
  const product = expected.binding.channel === "email" ? "mail" : "im";
  if (!object(raw.connection_params) || !object(raw.connection_params[product]) || !Array.isArray(raw.sources)) {
    return { status: "review", code: "protocol" };
  }
  const relevant = raw.sources.filter(source => object(source) && source.id === expected.sourceId);
  if (relevant.length !== 1 || !object(relevant[0])) return { status: "review", code: "protocol" };
  switch (relevant[0].status) {
    case "OK": return { status: "ready" };
    case "CONNECTING": return { status: "waiting", code: "incomplete" };
    case "PERMISSIONS": return { status: "review", code: "forbidden" };
    case "STOPPED": case "ERROR": case "CREDENTIALS": return { status: "review", code: "reconnect" };
    default: return { status: "review", code: "protocol" };
  }
}

/** Use only after an existing-chat write whose immutable account/chat/recipient mapping was verified
 * before dispatch. MessageSent contains no independent recipient/account proof and no timestamp. */
export function normalizeV1MessageSent(raw: unknown, input: MessageSubmission): DeliveryOutcome {
  if (!input || !validOperation(input.snapshot, "message") || !socialRecipient(input.snapshot.binding, input.message?.recipient) ||
      !matchesReference(input.snapshot.binding, input.message.conversation) || !object(raw) ||
      raw.object !== "MessageSent" || !addressableId(raw.message_id) ||
      (raw.chat_id !== undefined && raw.chat_id !== input.message.conversation.id)) return unknown();
  return { status: "submitted", receipt: {
    message: { binding: { ...input.snapshot.binding }, id: raw.message_id },
    conversation: { binding: { ...input.snapshot.binding }, id: input.message.conversation.id },
    recipient: { ...input.message.recipient },
  } };
}

/** Validate RFC3339 plus real calendar dates; Date.parse alone silently rolls February 30 forward. */
function validTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone] = match;
  const [year, month, day, hour, minute, second] = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate() ||
      hour > 23 || minute > 59 || second > 59) return false;
  if (zone !== "Z" && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4, 6)) > 59)) return false;
  return Number.isFinite(Date.parse(value));
}

/** Read-only correlation against an exact recorded Unipile message/account/chat. recipient must come
 * from a separately verified direct-chat mapping; expectedRecipient is the recorded operation's
 * recipient. Message has no To field: their equality is correlation, not independent identity proof.
 * Callers must not use this helper to recover a lost send response by recipient/text search. */
export function normalizeV1MessageLookup(raw: unknown, expected: V1MessageExpectation): DeliveryOutcome {
  if (!expected || !expected.lookup || !validOperation(expected.lookup.snapshot, "message")) return unknown();
  const binding = expected.lookup.snapshot.binding;
  const recordedRecipient = expected.lookup.expectedRecipient;
  if (!matchesReference(binding, expected.lookup.message) || !matchesReference(binding, expected.conversation) ||
      !addressableId(expected.providerAccountId) || !socialRecipient(binding, expected.recipient) || !recordedRecipient ||
      recordedRecipient.kind !== expected.recipient.kind || recordedRecipient.value !== expected.recipient.value ||
      !object(raw) || raw.object !== "Message" || raw.id !== expected.lookup.message.id ||
      (raw.message_id !== undefined && raw.message_id !== raw.id) || raw.account_id !== expected.providerAccountId ||
      raw.chat_id !== expected.conversation.id || raw.is_sender !== 1 || raw.is_event !== 0 ||
      raw.deleted !== 0 || raw.hidden !== 0 || !validTimestamp(raw.timestamp)) return unknown();
  return { status: "submitted", receipt: {
    message: { binding: { ...binding }, id: raw.id },
    conversation: { binding: { ...binding }, id: expected.conversation.id },
    recipient: { ...expected.recipient },
    submittedAt: raw.timestamp,
  } };
}

/** An invitation ID is an action reference, never a messaging endpoint's message ID. */
export function normalizeV1InvitationSent(raw: unknown, input: MessageSubmission): DeliveryOutcome {
  if (!input || !validOperation(input.snapshot, "invitation") || input.snapshot.binding.channel !== "linkedin" ||
      !socialRecipient(input.snapshot.binding, input.message?.recipient) || !object(raw) ||
      raw.object !== "UserInvitationSent" || !addressableId(raw.invitation_id)) return unknown();
  return { status: "submitted", receipt: {
    operation: { binding: { ...input.snapshot.binding }, id: raw.invitation_id },
    recipient: { ...input.message.recipient },
  } };
}
