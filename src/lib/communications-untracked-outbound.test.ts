import { describe, it, expect, vi } from "vitest";
import {
  assertUntrackedOutboundIsUnassociated,
  verifyUntrackedSentEmail,
} from "./communications-untracked-outbound";
const binding = {
  applicationId: "acquire",
  tenantId: "org",
  ownerId: "user",
  connectionId: "connection",
  accountId: "account",
  generation: 1,
  channel: "email",
  platform: "gmail",
  backend: "unipile",
} as const;
describe("canonical external outbound completion", () => {
  it("allows unrelated fully tracked submitted journals but retains unresolved or matching tracking work", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    await expect(
      assertUntrackedOutboundIsUnassociated(
        { query } as never,
        binding,
        "integration",
        "configuration",
        ["digest"],
      ),
    ).resolves.toBeUndefined();
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("j.state NOT IN ('submitted','delivered','read')");
    expect(sql).toContain("a.journal_id=j.id");
    expect(sql).toContain("a.tracking_digest=ANY($9::text[])");
    expect(params).toEqual([
      "acquire",
      "org",
      "user",
      "connection",
      1,
      "account",
      "integration",
      "configuration",
      ["digest"],
      null,
      null,
    ]);
    query.mockResolvedValueOnce({ rows: [{ blocked: true }] } as never);
    await expect(
      assertUntrackedOutboundIsUnassociated(
        { query } as never,
        binding,
        "integration",
        "configuration",
        ["digest"],
      ),
    ).rejects.toThrow("Send association");
  });
  it("checks original account and canonical sent identity without inventing a tracked receipt", async () => {
    const raw = {
      event: "mail_sent",
      origin: "unipile",
      role: "sent",
      account_id: "provider",
      tracking_id: "tracking",
      email_id: "message",
      message_id: "<message@example.test>",
      date: "2026-01-01T00:00:00.000Z",
      to_attendees: [{ identifier: "person@example.test" }],
      cc_attendees: [],
      bcc_attendees: [],
    };
    const email = {
      object: "Email",
      kind: "2_full",
      id: "message",
      account_id: "provider",
      type: "GOOGLE_OAUTH",
      role: "sent",
      message_id: raw.message_id,
      date: raw.date,
      from_attendee: { identifier: "owner@example.test" },
      to_attendees: raw.to_attendees,
      headers: [{ name: "Message-ID", value: raw.message_id }],
    };
    const verify = vi.fn(async () => ({
      binding,
      providerAccountId: "provider",
      ownerAddresses: ["owner@example.test"],
      raw: email,
    }));
    expect(
      await verifyUntrackedSentEmail(
        binding,
        raw,
        verify,
        AbortSignal.timeout(1000),
      ),
    ).toBe(true);
    for (const changed of [
      { ...raw, account_id: "foreign" },
      { ...raw, role: "inbox" },
      { ...raw, message_id: "<wrong@example.test>" },
      { ...raw, to_attendees: [{ identifier: "wrong@example.test" }] },
    ])
      expect(
        await verifyUntrackedSentEmail(
          binding,
          changed,
          verify,
          AbortSignal.timeout(1000),
        ),
      ).toBe(false);
    verify.mockResolvedValueOnce(null as never);
    expect(
      await verifyUntrackedSentEmail(
        binding,
        raw,
        verify,
        AbortSignal.timeout(1000),
      ),
    ).toBe(false);
    expect(
      await verifyUntrackedSentEmail(binding, raw, verify, AbortSignal.abort()),
    ).toBe(false);
  });
});
it("narrows unresolved journals only with exact persisted recipient key version; tracking match always blocks", async () => {
  const query = vi.fn(async () => ({ rows: [] }));
  await assertUntrackedOutboundIsUnassociated(
    { query } as never,
    binding,
    "integration",
    "configuration",
    ["digest"],
    { keyVersion: "identity-v1", digest: "a".repeat(64) },
  );
  const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
  expect(sql).toContain("j.recipient_key_version IS DISTINCT FROM $10");
  expect(sql).toContain("j.recipient_digest=$11");
  expect(params.slice(-2)).toEqual(["identity-v1", "a".repeat(64)]);
});
