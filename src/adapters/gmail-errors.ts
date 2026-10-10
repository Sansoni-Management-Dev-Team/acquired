import {
  ReplyCheckPending,
  ReplyCheckReview,
  replyHttpFailure,
} from "@/lib/campaign-reply-status";

// Provider JSON stays at the Gmail boundary; the scheduler sees only normalized failures.
export async function gmailReadHttpFailure(response: Response) {
  const body = await response
    .clone()
    .json()
    .catch(() => null);
  const reasons: string[] = (
    Array.isArray(body?.error?.errors) ? body.error.errors : []
  )
    .map((item: { reason?: string }) => item.reason)
    .filter(Boolean);
  if (
    response.status === 403 &&
    reasons.some((reason) =>
      ["rateLimitExceeded", "userRateLimitExceeded"].includes(reason),
    )
  ) {
    return replyHttpFailure(
      new Response(null, { status: 429, headers: response.headers }),
      "email",
    );
  }
  if (body?.error === "invalid_grant")
    return new ReplyCheckReview("reconnect", "email");
  if (response.status === 403 && reasons.includes("dailyLimitExceeded"))
    return new ReplyCheckReview("delivery_disabled", "email");
  return replyHttpFailure(response, "email");
}

// A confirmed rejection is distinct from a lost response after submission.
export class GmailSendRejected extends Error {
  constructor(public readonly failure: ReplyCheckPending | ReplyCheckReview) {
    super("Gmail rejected the submission");
  }
}
