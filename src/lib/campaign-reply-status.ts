import { type ReplyChannel, type replyCheckDiagnosticSchema, type replyRetryCodes, type replyReviewCodes } from "@/domain/campaign-replies";
import { campaignWorkDeferred } from "@/lib/campaign-work-budget";
import type { z } from "zod";

type Diagnostic = z.infer<typeof replyCheckDiagnosticSchema>;
type RetryCode = typeof replyRetryCodes[number];
type ReviewCode = typeof replyReviewCodes[number];

export class ReplyCheckPending extends Error {
  readonly status = 409;
  constructor(public readonly code: RetryCode, public readonly channel?: ReplyChannel,
    public readonly retryAt = new Date(Date.now() + 60_000), public readonly coverageAt: Date | null = null) {
    super("Reply monitoring is waiting; sending will retry when coverage is ready");
  }
}

export class ReplyCheckReview extends Error {
  readonly status = 409;
  constructor(public readonly code: ReviewCode, public readonly channel?: ReplyChannel, public readonly coverageAt: Date | null = null) {
    super("Reply monitoring needs review before sending");
  }
}

export function replyCheckFailure(error: unknown, channel?: ReplyChannel) {
  if (error instanceof ReplyCheckPending || error instanceof ReplyCheckReview) return error;
  const cause = error as { name?: string; message?: string; code?: string; cause?: { code?: string } } | null;
  if (["TimeoutError", "AbortError"].includes(cause?.name || "")) return new ReplyCheckPending("timeout", channel);
  if ((error instanceof TypeError && /fetch|network|request/i.test(error.message))
    || ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_SOCKET"].includes(cause?.code || cause?.cause?.code || "")) return new ReplyCheckPending("unavailable", channel);
  return new ReplyCheckReview(cause?.name === "ZodError" || cause?.name === "SyntaxError" ? "protocol" : "unexpected", channel);
}

// Persist only structured categories and timing, never provider bodies, URLs or credentials.
export function replyCheckDiagnostic(error: unknown): Diagnostic {
  const failure = replyCheckFailure(error);
  const fields = { ...(failure.channel ? { channel: failure.channel } : {}),
    coverageAt: failure.coverageAt?.toISOString() || null,
    coverageAgeMs: failure.coverageAt ? Math.max(0, Date.now() - failure.coverageAt.getTime()) : null };
  return failure instanceof ReplyCheckPending
    ? { ...fields, category: "retry", code: failure.code, retryAt: failure.retryAt.toISOString() }
    : { ...fields, category: "review", code: failure.code };
}

export async function replyHttpFailure(response: Response, channel: ReplyChannel) {
  const data = await response.json().catch(() => null);
  if (data?.detail?.code === "reply_unverified") return new ReplyCheckReview("protocol", channel);
  if (data?.detail?.code === "reconnect") return new ReplyCheckReview("reconnect", channel);
  if (data?.detail?.code === "account_changed") return new ReplyCheckReview("account_changed", channel);
  if (response.status === 429 || response.status >= 500) {
    const header = response.headers.get("Retry-After");
    const delay = header && /^\d+$/.test(header) ? Number(header) * 1000 : header ? Date.parse(header) - Date.now() : 60_000;
    const retryAt = new Date(Date.now() + Math.min(86400_000, Math.max(1000, Number.isFinite(delay) ? delay : 60_000)));
    return new ReplyCheckPending(response.status === 429 ? "rate_limited" : "unavailable", channel, retryAt);
  }
  return new ReplyCheckReview([401, 403, 409].includes(response.status) ? "reconnect" : "protocol", channel);
}

export async function replyRead<T>(channel: ReplyChannel, operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) { if (campaignWorkDeferred(error)) throw error; throw replyCheckFailure(error, channel); }
}
