import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readEmailReplyPage } from "./email-reply-reader";
const identities = Array.from({ length: 125 }, (_, i) => ({
  identity: `contact${String(i).padStart(3, "0")}@example.invalid`,
  since: new Date(0),
}));
function fixture() {
  return {
    accountIdentity: "mailbox:me",
    list: async (after: string | null) =>
      identities.filter((i) => !after || i.identity > after).slice(0, 2),
    find: async () => identities,
    mailbox: { inboundFrom: vi.fn().mockResolvedValue([]) },
  };
}
it("resumes more than 100 identities without a lasting review and completes only after every identity", async () => {
  const f = fixture();
  let cursor: string | null = null,
    complete = false,
    pages = 0;
  while (!complete && pages < 130) {
    const p = await readEmailReplyPage({ ...f, cursor });
    cursor = p.nextCursor;
    complete = p.complete;
    pages++;
  }
  expect(complete).toBe(true);
  expect(f.mailbox.inboundFrom).toHaveBeenCalledTimes(125);
  expect(pages).toBe(125);
});
it("persists per-recipient pagination and never advances past an unfinished conversation", async () => {
  const f = fixture();
  const paged = vi
    .fn()
    .mockResolvedValueOnce({ events: [], nextPageToken: "next" })
    .mockResolvedValueOnce({ events: [], nextPageToken: null });
  const mailbox = { ...f.mailbox, inboundPage: paged };
  const a = await readEmailReplyPage({ ...f, mailbox, cursor: null });
  expect(a.complete).toBe(false);
  await readEmailReplyPage({ ...f, mailbox, cursor: a.nextCursor });
  expect(paged.mock.calls[1][0]).toBe(identities[0].identity);
  expect(paged.mock.calls[1][2]).toBe("next");
});
it("uses history deltas after initial coverage and falls back to a scoped scan if history expires", async () => {
  const f = fixture();
  const mailbox = {
    ...f.mailbox,
    historyHead: vi.fn().mockResolvedValue("10"),
    historyPage: vi
      .fn()
      .mockResolvedValue({ events: [], nextPageToken: null, historyId: "11" }),
  };
  const list = async () => identities.slice(0, 1);
  const first = await readEmailReplyPage({ ...f, list, mailbox, cursor: null });
  expect(first.complete).toBe(true);
  const second = await readEmailReplyPage({
    ...f,
    list,
    mailbox,
    cursor: first.nextCursor,
  });
  expect(second.complete).toBe(true);
  expect(mailbox.historyPage).toHaveBeenCalledWith("10", null);
  mailbox.historyPage.mockRejectedValueOnce(
    Object.assign(Error("expired"), { historyExpired: true }),
  );
  const fallback = await readEmailReplyPage({
    ...f,
    list,
    mailbox,
    cursor: second.nextCursor,
  });
  expect(fallback.coverageInvalidated).toBe(true);
  expect(fallback.complete).toBe(false);
});
