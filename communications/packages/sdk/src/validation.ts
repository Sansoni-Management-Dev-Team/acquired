import { assertSameBinding, assertSubmissionReceiptMatches,
  type CanonicalIdentity, type ConnectionBinding, type DeliveryOutcome, type OperationSnapshot, type Readiness, type ProviderReference,
} from "../../contracts/src/index";

function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function fields(value: Record<string, unknown>, keys: readonly string[]) { return Object.keys(value).every((key) => keys.includes(key)); }
function text(value: unknown, max = 4096): value is string { return typeof value === "string" && !!value.trim() && value.length <= max; }
function optionalDate(value: unknown) { return value === undefined || (typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value))); }
const retryCodes = ["incomplete", "stale", "busy", "timeout", "rate_limited", "unavailable", "identity_pending"];
const reviewCodes = ["reconnect", "account_changed", "protocol", "unexpected", "delivery_disabled", "unresolved_send", "unsupported", "forbidden", "operation_conflict"];

export function isReadiness(value: unknown): value is Readiness {
  if (!object(value)) return false;
  if (value.status === "ready") return fields(value, ["status"]);
  if (value.status === "waiting") return fields(value, ["status", "code", "retryAt"]) && typeof value.code === "string" && retryCodes.includes(value.code) && optionalDate(value.retryAt);
  return value.status === "review" && fields(value, ["status", "code"]) && typeof value.code === "string" && reviewCodes.includes(value.code);
}
function identity(value: unknown): value is CanonicalIdentity {
  return object(value) && fields(value, ["kind", "value"]) && typeof value.kind === "string" && ["email", "phone", "linkedin_profile"].includes(value.kind) && text(value.value);
}
function reference(value: unknown, binding: ConnectionBinding): boolean {
  if (!object(value) || !fields(value, ["binding", "id"]) || !text(value.id) || !object(value.binding) ||
      !fields(value.binding, ["applicationId", "tenantId", "ownerId", "connectionId", "accountId", "generation", "channel", "platform", "backend"])) return false;
  try { assertSameBinding(binding, value.binding as unknown as ConnectionBinding); return true; } catch { return false; }
}
/** Runtime response boundary shared by the SDK and injected HTTP service. */
export function isDeliveryOutcome(value: unknown, snapshot: OperationSnapshot, recipient?: CanonicalIdentity, expectedMessage?: ProviderReference): value is DeliveryOutcome | null {
  if (value === null) return true;
  if (!object(value)) return false;
  if (value.status === "unknown") return fields(value, ["status"]);
  if (value.status === "submitted") {
    if (!fields(value, ["status", "receipt"]) || !object(value.receipt) || !identity(value.receipt.recipient)) return false;
    const receipt = value.receipt;
    const isMessage = "message" in receipt;
    const allowed = isMessage ? ["message", "conversation", "recipient", "submittedAt", "deliveredAt", "readAt"] : ["operation", "recipient", "submittedAt"];
    if (!fields(receipt, allowed) || !reference(isMessage ? receipt.message : receipt.operation, snapshot.binding) ||
        (receipt.conversation !== undefined && !reference(receipt.conversation, snapshot.binding)) ||
        ![receipt.submittedAt, receipt.deliveredAt, receipt.readAt].every(optionalDate)) return false;
    try {
      const typed = receipt as unknown as Extract<DeliveryOutcome, { status: "submitted" }>["receipt"];
      assertSubmissionReceiptMatches(snapshot, recipient ?? typed.recipient, typed);
      if (expectedMessage && (!("message" in typed) || typed.message.id !== expectedMessage.id)) return false;
      return true;
    } catch { return false; }
  }
  if (value.status === "skipped") return fields(value, ["status", "operation", "reason"]) && reference(value.operation, snapshot.binding) && text(value.reason, 512);
  if (value.status === "waiting" || value.status === "review") return isReadiness(value);
  return value.status === "rejected" && fields(value, ["status", "code"]) && typeof value.code === "string" && /^[a-zA-Z0-9_:/.-]{1,100}$/.test(value.code);
}
