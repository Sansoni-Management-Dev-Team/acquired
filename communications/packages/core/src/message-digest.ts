import { createHash } from "node:crypto";
import type { OperationSnapshot, OutboundMessage, ProviderReference } from "../../contracts/src/index";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, field]) => [key, canonical(field)]));
  }
  return value;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

/** Version the payload representation so extraction preserves journal fingerprints. */
export function messageDigest(operation: OperationSnapshot["operation"], message: OutboundMessage): string {
  return digest({ v: 1, operation, message });
}

export function draftDigest(operation: "draft_update" | "draft_delete", draft: ProviderReference, message?: OutboundMessage): string {
  return digest({ v: 1, operation, draft, message });
}
