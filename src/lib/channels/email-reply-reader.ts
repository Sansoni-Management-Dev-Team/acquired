import { z } from "zod";
import type { ReplyPage } from "@/domain/campaign-replies";
import type { CampaignMailbox } from "@/lib/campaign-mailbox";
const checkpointSchema = z
  .object({
    v: z.literal(2),
    mode: z.enum(["full", "delta"]),
    after: z.string().nullable(),
    pageToken: z.string().max(1800).nullable(),
    watermark: z.iso.datetime().nullable(),
    scanStartedAt: z.iso.datetime().nullable(),
    historyId: z.string().regex(/^\d+$/).nullable(),
  })
  .strict();
type Identity = { identity: string; since: Date };
export async function readEmailReplyPage(input: {
  accountIdentity: string;
  cursor: string | null;
  list: (after: string | null) => Promise<Identity[]>;
  find: (addresses: string[]) => Promise<Identity[]>;
  mailbox: Pick<
    CampaignMailbox,
    "inboundFrom" | "inboundPage" | "historyHead" | "historyPage"
  >;
}): Promise<ReplyPage> {
  const parsed = input.cursor
    ? checkpointSchema.safeParse(JSON.parse(input.cursor))
    : null;
  const legacy = !!parsed && !parsed.success;
  let c = parsed?.success
    ? parsed.data
    : {
        v: 2 as const,
        mode: "full" as const,
        after: null,
        pageToken: null,
        watermark: null,
        scanStartedAt: null,
        historyId: null,
      };
  const now = new Date().toISOString();
  const result = (
    events: ReplyPage["events"],
    complete: boolean,
    checkedAt: string,
    coverageInvalidated = false,
  ): ReplyPage => ({
    accountIdentity: input.accountIdentity,
    events,
    complete,
    checkedAt,
    nextCursor: JSON.stringify(c),
    ...(coverageInvalidated ? { coverageInvalidated: true } : {}),
  });
  if (c.mode === "delta" && c.historyId && input.mailbox.historyPage) {
    try {
      const page = await input.mailbox.historyPage(c.historyId, c.pageToken);
      const known = await input.find([
        ...new Set(page.events.map((e) => e.fromIdentity)),
      ]);
      const events = page.events.filter((e) =>
        known.some(
          (i) =>
            i.identity === e.fromIdentity && new Date(e.receivedAt) >= i.since,
        ),
      );
      const checkedAt = c.scanStartedAt || now;
      const complete = !page.nextPageToken;
      c = {
        ...c,
        pageToken: page.nextPageToken,
        scanStartedAt: complete ? null : checkedAt,
        historyId: complete ? page.historyId : c.historyId,
        watermark: complete ? checkedAt : c.watermark,
      };
      return result(events, complete, checkedAt);
    } catch (error) {
      if (!(error as { historyExpired?: boolean }).historyExpired) throw error;
      c = {
        v: 2,
        mode: "full",
        after: null,
        pageToken: null,
        watermark: null,
        scanStartedAt: null,
        historyId: null,
      };
      return result([], false, now, true);
    }
  }
  if (!c.scanStartedAt) {
    c = {
      ...c,
      scanStartedAt: now,
      historyId: input.mailbox.historyHead
        ? await input.mailbox.historyHead()
        : null,
    };
  }
  const checkedAt = c.scanStartedAt!;
  const identities = await input.list(c.after);
  const identity = identities[0];
  let events: ReplyPage["events"] = [],
    token: string | null = null;
  if (identity) {
    const since = c.watermark
      ? new Date(
          Math.max(identity.since.getTime(), Date.parse(c.watermark) - 120000),
        )
      : identity.since;
    if (input.mailbox.inboundPage) {
      const page = await input.mailbox.inboundPage(
        identity.identity,
        since,
        c.pageToken,
      );
      events = page.events.map((e) => ({
        id: e.id,
        fromIdentity: identity.identity,
        receivedAt: e.receivedAt.toISOString(),
      }));
      token = page.nextPageToken;
    } else
      events = (await input.mailbox.inboundFrom(identity.identity, since)).map(
        (e) => ({
          id: e.id,
          fromIdentity: identity.identity,
          receivedAt: e.receivedAt.toISOString(),
        }),
      );
  }
  const complete = !token && identities.length <= 1;
  c = {
    ...c,
    mode: complete && c.historyId ? "delta" : "full",
    after: complete ? null : token ? c.after : identity?.identity || c.after,
    pageToken: token,
    watermark: complete ? checkedAt : c.watermark,
    scanStartedAt: complete ? null : checkedAt,
  };
  return result(events, complete, checkedAt, legacy);
}
