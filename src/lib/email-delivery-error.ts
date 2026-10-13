import type { ReplyCheckPending, ReplyCheckReview } from "./campaign-reply-status";

/** A provider has definitely rejected this email before acceptance. */
export class EmailSubmissionRejected extends Error {
  constructor(public readonly failure: ReplyCheckPending | ReplyCheckReview) { super("Email submission was rejected"); }
}
