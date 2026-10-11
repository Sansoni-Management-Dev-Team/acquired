export class ServiceFailure extends Error {
  constructor(code, status = 409, retryAt) {
    super(
      code === "incomplete"
        ? "Reply inbox not synchronized"
        : code === "reply_unverified"
          ? "WhatsApp sender identity requires review"
          : "WhatsApp operation cannot proceed",
    );
    this.code = code;
    this.status = status;
    this.retryAt = retryAt;
  }
}
export const waiting = (code = "incomplete", delayMs = 60000) =>
  new ServiceFailure(code, 409, new Date(Date.now() + delayMs).toISOString());
export const review = (code) => new ServiceFailure(code);
const safeCodes = new Set([
  "incomplete",
  "busy",
  "timeout",
  "rate_limited",
  "unavailable",
  "identity_pending",
  "reply_unverified",
  "reconnect",
  "account_changed",
  "delivery_disabled",
]);
export function failureBody(error) {
  const parsedAt =
    typeof error.retryAt === "string" ? Date.parse(error.retryAt) : NaN;
  const retryAt = Number.isFinite(parsedAt)
    ? new Date(parsedAt).toISOString()
    : null;
  const code =
    (safeCodes.has(error.code) ? error.code : null) ||
    (error.status === 403
      ? "reconnect"
      : error.status === 409
        ? "busy"
        : "unavailable");
  return {
    error: "WhatsApp operation cannot proceed",
    detail: { code, ...(retryAt ? { retryAt } : {}) },
  };
}
