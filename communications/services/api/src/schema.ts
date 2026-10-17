import {
  assertSameBinding, type CanonicalIdentity, type ConnectionBinding,
  type MessageSubmission, type OperationSnapshot, type OutboundMessage,
  type ProviderReference, type ReceiptLookup,
} from "../../../packages/contracts/src/index";

export class InvalidRequest extends Error {}
function invalid(): never { throw new InvalidRequest(); }
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some((key) => !keys.includes(key))) invalid();
  return result;
}
function string(value: unknown, max = 2048): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) invalid();
  return value;
}
function optionalString(value: unknown, max = 2048) { return value === undefined ? undefined : string(value, max); }
export function parseBinding(value: unknown): ConnectionBinding {
  const obj = object(value, ["applicationId", "tenantId", "ownerId", "connectionId", "accountId", "generation", "channel", "platform", "backend"]);
  for (const field of ["applicationId", "tenantId", "ownerId", "connectionId", "accountId", "channel", "platform", "backend"]) string(obj[field]);
  const binding = obj as unknown as ConnectionBinding;
  try { assertSameBinding(binding, binding); } catch { invalid(); }
  return binding;
}
function identity(value: unknown): CanonicalIdentity {
  const obj = object(value, ["kind", "value"]);
  if (!["email", "phone", "linkedin_profile"].includes(string(obj.kind))) invalid();
  const identityValue = string(obj.value);
  if (obj.kind === "email" && identityValue !== identityValue.trim().toLowerCase()) invalid();
  return { kind: obj.kind as CanonicalIdentity["kind"], value: identityValue };
}
function assertRecipientChannel(recipient: CanonicalIdentity, binding: ConnectionBinding) {
  const requiredKind = { email: "email", whatsapp: "phone", linkedin: "linkedin_profile" };
  if (recipient.kind !== requiredKind[binding.channel]) invalid();
}
function reference(value: unknown): ProviderReference {
  const obj = object(value, ["binding", "id"]);
  return { binding: parseBinding(obj.binding), id: string(obj.id) };
}
function snapshot(value: unknown): OperationSnapshot {
  const obj = object(value, ["key", "binding", "operation", "payloadDigest"]);
  if (obj.operation !== "message" && obj.operation !== "invitation") invalid();
  const payloadDigest = string(obj.payloadDigest, 64);
  if (!/^[0-9a-f]{64}$/.test(payloadDigest)) invalid();
  return { key: string(obj.key, 255), binding: parseBinding(obj.binding), operation: obj.operation, payloadDigest };
}
export function parseReady(value: unknown): ConnectionBinding {
  return parseBinding(object(value, ["binding"]).binding);
}
export function parseSubmission(value: unknown): MessageSubmission {
  const obj = object(value, ["snapshot", "message"]);
  const recorded = snapshot(obj.snapshot);
  const raw = object(obj.message, ["recipient", "text", "subject", "conversation", "rfcMessageId", "replyTo", "replyParent"]);
  if (typeof raw.text !== "string" || raw.text.length > 100_000) invalid();
  const message: OutboundMessage = {
    recipient: identity(raw.recipient), text: raw.text,
    ...(raw.subject === undefined ? {} : { subject: optionalString(raw.subject, 1000) }),
    ...(raw.conversation === undefined ? {} : { conversation: reference(raw.conversation) }),
    ...(raw.rfcMessageId === undefined ? {} : { rfcMessageId: optionalString(raw.rfcMessageId) }),
    ...(raw.replyParent === undefined ? {} : {replyParent:(()=>{const parent=object(raw.replyParent,['message','contentDigest']),contentDigest=string(parent.contentDigest,64);if(!/^[a-f0-9]{64}$/.test(contentDigest)||recorded.binding.channel!=='email'||raw.conversation!==undefined)invalid();const original=reference(parent.message);try{assertSameBinding(recorded.binding,original.binding);}catch{invalid();}return {message:original,contentDigest};})()}),
    ...(raw.replyTo === undefined ? {} : { replyTo: optionalString(raw.replyTo) }),
  };
  assertRecipientChannel(message.recipient, recorded.binding);
  return { snapshot: recorded, message };
}
export function parseLookup(value: unknown): ReceiptLookup {
  const obj = object(value, ["snapshot", "message", "rfcMessageId", "expectedRecipient"]);
  const recorded = snapshot(obj.snapshot);
  const expectedRecipient = obj.expectedRecipient === undefined ? undefined : identity(obj.expectedRecipient);
  if (expectedRecipient) assertRecipientChannel(expectedRecipient, recorded.binding);
  return { snapshot: recorded,
    ...(obj.message === undefined ? {} : { message: reference(obj.message) }),
    ...(obj.rfcMessageId === undefined ? {} : { rfcMessageId: optionalString(obj.rfcMessageId) }),
    ...(expectedRecipient === undefined ? {} : { expectedRecipient }),
  };
}
