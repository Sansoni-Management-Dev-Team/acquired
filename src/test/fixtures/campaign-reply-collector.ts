// Test-only historical reply characterization; no production import is permitted.
import { replyPageSchema, type ReplyPage } from "@/domain/campaign-replies";
import { ReplyCheckReview } from "@/lib/campaign-reply-status";
import { campaignRemainingMs } from "@/lib/campaign-work-budget";

// Each page is committed with its events in one transaction. Only a complete
// scan may advance freshness; a partial scan still has a resumable checkpoint.
export async function collectReplyPages(input: {
  cursor: string | null; accountIdentity: string | null; maxPages?: number;
  read: (cursor: string | null) => Promise<unknown>;
  commit: (page: ReplyPage) => Promise<boolean>;
}) {
  let cursor = input.cursor;
  let accountIdentity = input.accountIdentity;
  const seen = new Set([cursor]);
  for (let count = 0; count < (input.maxPages ?? 5); count++) {
    if (campaignRemainingMs() === 0) return { complete: false, cursor, deferred: true };
    const page = replyPageSchema.parse(await input.read(cursor));
    const waiting = !page.complete && page.nextReadAt !== undefined && new Date(page.nextReadAt).getTime() > Date.now();
    if (accountIdentity && accountIdentity !== page.accountIdentity) throw new ReplyCheckReview("account_changed");
    if (!page.complete && (page.nextCursor === null || (seen.has(page.nextCursor) && !(waiting && page.nextCursor === cursor)))) throw new Error("Reply monitor checkpoint did not advance");
    if (new Date(page.checkedAt).getTime() > Date.now() + 5000 || page.events.some(event => new Date(event.receivedAt).getTime() > Date.now() + 5000)) throw new Error("Invalid reply monitor timestamps");
    if (!await input.commit(page)) return { complete: false, cursor };
    cursor = page.nextCursor; accountIdentity = page.accountIdentity; seen.add(cursor);
    if (page.complete) return { complete: true, cursor };
    if (waiting) return { complete: false, cursor, nextReadAt: page.nextReadAt };
  }
  return { complete: false, cursor };
}
