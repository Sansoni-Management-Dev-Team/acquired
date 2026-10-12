import { createHmac, timingSafeEqual } from "node:crypto";

export interface UnipileWebhookVerificationInput {
  rawBody: Uint8Array;
  signature: string | null;
  secret: string;
  nowSeconds: number;
  maxAgeSeconds?: number;
  futureToleranceSeconds?: number;
}

export type UnipileWebhookVerification =
  | { verified: true; timestamp: number }
  | { verified: false; reason: "configuration" | "header" | "timestamp" | "signature" };

/** Pure authentication only. Durable event persistence, tenancy and replay deduplication are separate. */
export function verifyUnipileWebhook(input: UnipileWebhookVerificationInput): UnipileWebhookVerification {
  const maxAge = input.maxAgeSeconds ?? 300;
  const futureTolerance = input.futureToleranceSeconds ?? 30;
  const validSeconds = (value: number, max: number) => Number.isSafeInteger(value) && value >= 0 && value <= max;
  if (!input.secret || !validSeconds(input.nowSeconds, Number.MAX_SAFE_INTEGER) ||
      !validSeconds(maxAge, 3600) || !validSeconds(futureTolerance, 300)) {
    return { verified: false, reason: "configuration" };
  }
  // One exact versioned pair; duplicate keys and ambiguous formats fail closed.
  const match = input.signature?.match(/^t=(\d{1,16}),v0=([0-9a-f]{64})$/);
  if (!match || !Number.isSafeInteger(Number(match[1]))) return { verified: false, reason: "header" };
  const timestamp = Number(match[1]);
  const age = input.nowSeconds - timestamp;
  if (age > maxAge || age < -futureTolerance) return { verified: false, reason: "timestamp" };
  const expected = createHmac("sha256", input.secret).update(`${match[1]}.`).update(input.rawBody).digest();
  const received = Buffer.from(match[2], "hex");
  if (!timingSafeEqual(expected, received)) return { verified: false, reason: "signature" };
  return { verified: true, timestamp };
}
