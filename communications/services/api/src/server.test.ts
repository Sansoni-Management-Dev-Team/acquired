import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommunicationsClient, type CommunicationsClientConfig } from "../../../packages/sdk/src/index";
import { createCommunicationsServer } from "./server";
import type { AccessScope, ConnectionBinding, ConnectionRecord, MessageSubmission, MessagingAdapter } from "../../../packages/contracts/src/index";
import { messageDigest } from "../../../packages/core/src/message-digest";

const key = "synthetic-service-key";
const scope: AccessScope = { applicationId: "fixture-app", tenantId: "fixture-tenant", ownerId: "fixture-owner" };
const binding: ConnectionBinding = { ...scope, connectionId: "fixture-connection", accountId: "fixture-account", generation: 1,
  channel: "whatsapp", platform: "whatsapp", backend: "baileys" };
const connection: ConnectionRecord = { binding, status: "connected", capabilities: {
  messaging: { send: true, durableIdempotency: false, receiptLookup: true }, events: { read: false, history: false, realtime: false },
} };
const message = { recipient: { kind: "phone" as const, value: "+15555550123" }, text: "Synthetic fixture" };
const submission: MessageSubmission = { snapshot: { binding, key: "fixture-operation", operation: "message",
  payloadDigest: messageDigest("message", message) }, message };
const receipt = { status: "submitted" as const, receipt: { message: { binding, id: "fixture-message" }, recipient: message.recipient } };
const closers: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.all(closers.splice(0).map((close) => close())); });

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closers.push(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture listener");
  return `http://127.0.0.1:${address.port}`;
}

async function fixture(options: { connected?: ConnectionRecord; records?: ConnectionRecord[]; adapter?: MessagingAdapter } = {}) {
  const adapter = options.adapter ?? { ready: vi.fn(async () => ({ status: "ready" as const })),
    submit: vi.fn(async () => receipt), lookup: vi.fn(async () => receipt) };
  const records = options.records ?? [options.connected ?? connection];
  const connections = { get: vi.fn(async (_trusted: AccessScope, id: string, generation: number) =>
    records.find((record) => record.binding.connectionId === id && record.binding.generation === generation) ?? null) };
  const resolver = vi.fn(async () => adapter);
  const server = createCommunicationsServer({
    authorize: async (request: import("node:http").IncomingMessage) => request.headers.authorization === `Bearer ${key}` ? scope : null,
    connections, resolveAdapter: resolver,
  });
  const baseUrl = await listen(server);
  const client = new CommunicationsClient({ baseUrl, contractVersion: "1", apiKey: key, allowLoopbackHttp: true, timeoutMs: 200 });
  return { client, adapter, connections, resolver, baseUrl };
}

describe("standalone communications SDK to native API boundary", () => {
  it("exposes versioned health without credentials and handles readiness/submit/read-only lookup", async () => {
    const f = await fixture();
    expect(await f.client.health()).toEqual({ contractVersion: "1" });
    expect(await f.client.ready(binding)).toEqual({ status: "ready" });
    expect(await f.client.submit(submission)).toEqual(receipt);
    expect(await f.client.lookup({ snapshot: submission.snapshot, expectedRecipient: message.recipient })).toEqual(receipt);
    expect(f.adapter.submit).toHaveBeenCalledTimes(1);
    expect(f.adapter.lookup).toHaveBeenCalledTimes(1);
    expect(f.connections.get).toHaveBeenCalledWith(scope, binding.connectionId, binding.generation);
  });

  it("does not trust body owner/tenant claims and does not resolve or dispatch unauthorized work", async () => {
    const f = await fixture();
    const wrongKey = new CommunicationsClient({ baseUrl: f.baseUrl, contractVersion: "1", apiKey: "wrong-synthetic-key", allowLoopbackHttp: true });
    await expect(wrongKey.submit(submission)).rejects.toMatchObject({ code: "unauthorized", status: 401 });
    for (const changed of [{ ownerId: "other-owner" }, { tenantId: "other-tenant" }, { applicationId: "other-app" }]) {
      await expect(f.client.ready({ ...binding, ...changed })).rejects.toMatchObject({ code: "forbidden", status: 403 });
    }
    expect(f.resolver).not.toHaveBeenCalled();
    expect(f.adapter.submit).not.toHaveBeenCalled();
  });

  it("rejects stale account/backend/generation snapshots without using defaults", async () => {
    const f = await fixture();
    for (const changed of [{ generation: 2 }, { accountId: "other-account" }, { backend: "unipile" as const }]) {
      await expect(f.client.submit({ ...submission, snapshot: { ...submission.snapshot, binding: { ...binding, ...changed } } }))
        .rejects.toMatchObject({ code: "generation" in changed ? "connection_unavailable" : "binding_changed", status: 409 });
    }
    expect(f.resolver).not.toHaveBeenCalled();
    expect(f.adapter.submit).not.toHaveBeenCalled();
  });

  it("rejects malformed/oversized/unknown-field bodies and contract version mismatches", async () => {
    const f = await fixture();
    for (const body of ["not json", JSON.stringify({ binding, ownerId: "forged" }), JSON.stringify({ binding: {} })]) {
      const response = await fetch(`${f.baseUrl}/v1/ready`, { method: "POST", headers: {
        authorization: `Bearer ${key}`, "x-communications-contract-version": "1", "content-type": "application/json",
      }, body });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: { code: "invalid_request" } });
    }
    const wrongVersion = await fetch(`${f.baseUrl}/v1/ready`, { method: "POST", headers: {
      authorization: `Bearer ${key}`, "x-communications-contract-version": "2", "content-type": "application/json",
    }, body: JSON.stringify({ binding }) });
    expect(wrongVersion.status).toBe(409);
    const oversized = await fetch(`${f.baseUrl}/v1/ready`, { method: "POST", headers: {
      authorization: `Bearer ${key}`, "x-communications-contract-version": "1", "content-type": "application/json",
    }, body: "x".repeat(300_000) });
    expect(oversized.status).toBe(413);
    expect(f.resolver).not.toHaveBeenCalled();
  });

  it("rejects forged payload digest before dispatch", async () => {
    const f = await fixture();
    await expect(f.client.submit({ ...submission, message: { ...message, text: "Changed content" } }))
      .rejects.toMatchObject({ code: "operation_conflict", status: 409 });
    expect(f.adapter.submit).not.toHaveBeenCalled();
  });

  it("keeps receipt recovery on disconnected original connection without readiness/connect/send", async () => {
    const f = await fixture({ connected: { ...connection, status: "disconnected" } });
    expect(await f.client.lookup({ snapshot: submission.snapshot })).toEqual(receipt);
    expect(f.adapter.ready).not.toHaveBeenCalled();
    expect(f.adapter.submit).not.toHaveBeenCalled();
    await expect(f.client.submit(submission)).rejects.toMatchObject({ code: "connection_unavailable", status: 409 });
    expect(f.adapter.submit).not.toHaveBeenCalled();
  });

  it("rejects lookup dispatch content and mismatched returned receipts", async () => {
    const f = await fixture({ adapter: { ready: async () => ({ status: "ready" }), submit: async () => receipt,
      lookup: async () => ({ ...receipt, receipt: { ...receipt.receipt, message: { ...receipt.receipt.message, binding: { ...binding, accountId: "wrong" } } } }) } });
    await expect(f.client.lookup({ snapshot: submission.snapshot })).rejects.toMatchObject({ code: "receipt_mismatch", status: 409 });
    const response = await fetch(`${f.baseUrl}/v1/lookup`, { method: "POST", headers: {
      authorization: `Bearer ${key}`, "x-communications-contract-version": "1", "content-type": "application/json",
    }, body: JSON.stringify({ snapshot: submission.snapshot, message: submission.message }) });
    expect(response.status).toBe(400);
  });

  it("preserves uncertainty after one dispatch when the response is lost and lookup remains read-only", async () => {
    const f = await fixture();
    const droppingProxy = createServer((req) => {
      let raw = "";
      req.on("data", (chunk) => { raw += chunk; });
      req.on("end", async () => {
        const upstream = await fetch(`${f.baseUrl}${req.url}`, { method: req.method, headers: req.headers as Record<string, string>, body: raw });
        await upstream.text();
        req.socket.destroy();
      });
    });
    const baseUrl = await listen(droppingProxy);
    const client = new CommunicationsClient({ baseUrl, contractVersion: "1", apiKey: key, allowLoopbackHttp: true, timeoutMs: 200 });
    expect(await client.submit(submission)).toEqual({ status: "unknown" });
    expect(f.adapter.submit).toHaveBeenCalledTimes(1);
    expect(await f.client.lookup({ snapshot: submission.snapshot })).toEqual(receipt);
    expect(f.adapter.submit).toHaveBeenCalledTimes(1);
  });

  it("sanitizes unexpected adapter/auth failures and preserves uncertain submissions", async () => {
    const f = await fixture({ adapter: { ready: async () => { throw new Error(key); },
      submit: async () => { throw new Error(`Private body ${key}`); }, lookup: async () => { throw new Error(key); } } });
    expect(await f.client.submit(submission)).toEqual({ status: "unknown" });
    await expect(f.client.ready(binding)).rejects.toMatchObject({ code: "internal", status: 500 });
    await expect(f.client.lookup({ snapshot: submission.snapshot })).rejects.toMatchObject({ code: "internal", status: 500 });
  });

  it("does not convert an invalid receipt after dispatch into a known rejection", async () => {
    const f = await fixture({ adapter: { ready: async () => ({ status: "ready" }), lookup: async () => null,
      submit: async () => ({ ...receipt, receipt: { ...receipt.receipt, message: { ...receipt.receipt.message, binding: { ...binding, generation: 2 } } } }) } });
    expect(await f.client.submit(submission)).toEqual({ status: "unknown" });
  });

  it("preserves a service journal action receipt without fabricating provider message provenance", async () => {
    const actionReceipt = { status: "submitted" as const, receipt: { operation: { binding, id: "fixture-journal-action" }, recipient: message.recipient } };
    const f = await fixture({ adapter: { ready: async () => ({ status: "ready" }), submit: async () => actionReceipt, lookup: async () => actionReceipt } });
    expect(await f.client.submit(submission)).toEqual(actionReceipt);
    expect(await f.client.lookup({ snapshot: submission.snapshot })).toEqual(actionReceipt);
  });

  it("fails closed on unexpected adapter response fields and unsupported readiness codes", async () => {
    const unsafeReceipt = { ...receipt, privateDebug: key };
    const f = await fixture({ adapter: { ready: async () => ({ status: "review", code: "private-provider-detail" } as never),
      submit: async () => unsafeReceipt, lookup: async () => null } });
    await expect(f.client.ready(binding)).rejects.toMatchObject({ code: "internal", status: 500 });
    const response = await fetch(`${f.baseUrl}/v1/submit`, { method: "POST", headers: {
      authorization: `Bearer ${key}`, "x-communications-contract-version": "1", "content-type": "application/json",
    }, body: JSON.stringify(submission) });
    expect(await response.json()).toEqual({ status: "unknown" });
  });

  it("requires explicit compatible SDK version, secure URL and bounded request policy", () => {
    for (const config of [
      { baseUrl: "https://fixture.invalid", contractVersion: "2", apiKey: key },
      { baseUrl: "http://fixture.invalid", contractVersion: "1", apiKey: key },
      { baseUrl: "https://user:password@fixture.invalid", contractVersion: "1", apiKey: key },
      { baseUrl: "https://fixture.invalid?key=bad", contractVersion: "1", apiKey: key },
      { baseUrl: "https://fixture.invalid", contractVersion: "1", apiKey: key, timeoutMs: 0 },
    ]) expect(() => new CommunicationsClient(config as CommunicationsClientConfig)).toThrow("Invalid communications client configuration");
  });

  it("never retries an injected submit timeout or follows redirects", async () => {
    const fetcher = vi.fn<typeof globalThis.fetch>(() => new Promise<Response>(() => {}));
    const client = new CommunicationsClient({ baseUrl: "https://fixture.invalid", contractVersion: "1", apiKey: key, fetch: fetcher, timeoutMs: 10 });
    expect(await client.submit(submission)).toEqual({ status: "unknown" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: "error" });
  });

  it("handles LinkedIn invitations through their original adapter and action receipt", async () => {
    const linkedinBinding: ConnectionBinding = { ...binding, channel: "linkedin", platform: "linkedin", backend: "browser" };
    const linkedinConnection: ConnectionRecord = { ...connection, binding: linkedinBinding,
      capabilities: { ...connection.capabilities, linkedin: { resolveProfile: true, relationships: true, invitations: true } } };
    const inviteMessage = { recipient: { kind: "linkedin_profile" as const, value: "fixture-profile" }, text: "Synthetic invitation" };
    const invite: MessageSubmission = { snapshot: { ...submission.snapshot, binding: linkedinBinding, operation: "invitation",
      payloadDigest: messageDigest("invitation", inviteMessage) }, message: inviteMessage };
    const inviteReceipt = { status: "submitted" as const, receipt: { operation: { binding: linkedinBinding, id: "fixture-invitation-action" }, recipient: inviteMessage.recipient } };
    const f = await fixture({ connected: linkedinConnection, adapter: { ready: async () => ({ status: "ready" }),
      submit: vi.fn(async () => inviteReceipt), lookup: vi.fn(async () => inviteReceipt) } });
    expect(await f.client.submit(invite)).toEqual(inviteReceipt);
    expect(await f.client.lookup({ snapshot: invite.snapshot })).toEqual(inviteReceipt);
    expect(f.adapter.submit).toHaveBeenCalledWith(invite);
    await expect(f.client.submit({ ...submission, snapshot: { ...submission.snapshot, operation: "invitation", payloadDigest: messageDigest("invitation", message) } }))
      .rejects.toMatchObject({ status: 409 });
    expect(f.adapter.submit).toHaveBeenCalledTimes(1);
  });

  it("blocks invitation without the recorded LinkedIn capability and never uses another adapter", async () => {
    const linkedinBinding: ConnectionBinding = { ...binding, channel: "linkedin", platform: "linkedin", backend: "browser" };
    const f = await fixture({ connected: { ...connection, binding: linkedinBinding } });
    const invitationMessage = { ...message, recipient: { kind: "linkedin_profile" as const, value: "fixture-profile" } };
    const invitation = { ...submission, message: invitationMessage, snapshot: { ...submission.snapshot, binding: linkedinBinding, operation: "invitation" as const,
      payloadDigest: messageDigest("invitation", invitationMessage) } };
    await expect(f.client.submit(invitation)).rejects.toMatchObject({ code: "unsupported", status: 409 });
    expect(f.resolver).not.toHaveBeenCalled();
  });

  it("does not treat an unrecognized 4xx proxy payload as confirmed nonacceptance", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: { code: "arbitrary_proxy_detail" } }), {
      status: 409, headers: { "X-Communications-Contract-Version": "1" },
    }));
    const client = new CommunicationsClient({ baseUrl: "https://fixture.invalid", contractVersion: "1", apiKey: key, fetch: fetcher });
    expect(await client.submit(submission)).toEqual({ status: "unknown" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("captures caller submission snapshots before awaiting the transport", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fetcher = vi.fn(async () => { await gate; return new Response(JSON.stringify(receipt), {
      headers: { "X-Communications-Contract-Version": "1" },
    }); });
    const client = new CommunicationsClient({ baseUrl: "https://fixture.invalid", contractVersion: "1", apiKey: key, fetch: fetcher });
    const mutable = structuredClone(submission);
    const pending = client.submit(mutable);
    mutable.snapshot.binding.ownerId = "changed-during-await";
    mutable.message.recipient.value = "changed-during-await";
    release();
    expect(await pending).toEqual(receipt);
  });

  it("lookup must match the supplied original provider message ID", async () => {
    const f = await fixture();
    await expect(f.client.lookup({ snapshot: submission.snapshot, message: { binding, id: "different-message" } }))
      .rejects.toMatchObject({ code: "receipt_mismatch", status: 409 });
  });
  it("rejects a non-string readiness code rather than coercing it into the contract", async () => {
    const f = await fixture({ adapter: { ready: async () => ({ status: "review", code: ["reconnect"] } as never),
      submit: async () => receipt, lookup: async () => null } });
    await expect(f.client.ready(binding)).rejects.toMatchObject({ code: "internal", status: 500 });
  });

  it("recovers the immutable original generation while a newer backend generation is active", async () => {
    const historical = { ...connection, status: "disconnected" as const };
    const active = { ...connection, binding: { ...binding, generation: 2, accountId: "new-account", backend: "unipile" as const } };
    const f = await fixture({ records: [active, historical] });
    expect(await f.client.lookup({ snapshot: submission.snapshot, message: receipt.receipt.message })).toEqual(receipt);
    expect(f.connections.get).toHaveBeenCalledWith(scope, binding.connectionId, 1);
    expect(f.resolver).toHaveBeenCalledWith(historical, scope);
    expect(f.adapter.submit).not.toHaveBeenCalled();
    await expect(f.client.submit(submission)).rejects.toMatchObject({ code: "connection_unavailable", status: 409 });
    expect(f.adapter.submit).not.toHaveBeenCalled();
    await expect(f.client.lookup({ snapshot: { ...submission.snapshot, binding: { ...binding, generation: 3 } } }))
      .rejects.toMatchObject({ code: "connection_unavailable", status: 409 });
    await expect(f.client.lookup({ snapshot: { ...submission.snapshot, binding: { ...binding, ownerId: "foreign-owner" } } }))
      .rejects.toMatchObject({ code: "forbidden", status: 403 });
    expect(f.resolver).toHaveBeenCalledTimes(1);
    expect(f.adapter.lookup).toHaveBeenCalledTimes(1);
  });

  it("requires canonical email recipients and lookup correlation before reaching an adapter", async () => {
    const emailBinding: ConnectionBinding = { ...binding, channel: "email", platform: "gmail", backend: "direct" };
    const f = await fixture({ connected: { ...connection, binding: emailBinding } });
    for (const value of ["Recipient@Example.invalid", " recipient@example.invalid "]) {
      const emailMessage = { ...message, recipient: { kind: "email" as const, value } };
      const emailSubmission = { snapshot: { ...submission.snapshot, binding: emailBinding,
        payloadDigest: messageDigest("message", emailMessage) }, message: emailMessage };
      await expect(f.client.submit(emailSubmission)).rejects.toMatchObject({ code: "invalid_request", status: 400 });
      await expect(f.client.lookup({ snapshot: emailSubmission.snapshot, expectedRecipient: emailMessage.recipient }))
        .rejects.toMatchObject({ code: "invalid_request", status: 400 });
    }
    expect(f.resolver).not.toHaveBeenCalled();
    expect(f.adapter.submit).not.toHaveBeenCalled();
    expect(f.adapter.lookup).not.toHaveBeenCalled();
  });

  it("rejects recipient kinds that do not match the recorded channel before dispatch", async () => {
    const f = await fixture();
    for (const recipient of [{ kind: "email" as const, value: "recipient@example.invalid" },
      { kind: "linkedin_profile" as const, value: "fixture-profile" }]) {
      const changedMessage = { ...message, recipient };
      await expect(f.client.submit({ snapshot: { ...submission.snapshot,
        payloadDigest: messageDigest("message", changedMessage) }, message: changedMessage }))
        .rejects.toMatchObject({ code: "invalid_request", status: 400 });
      await expect(f.client.lookup({ snapshot: submission.snapshot, expectedRecipient: recipient }))
        .rejects.toMatchObject({ code: "invalid_request", status: 400 });
    }
    expect(f.resolver).not.toHaveBeenCalled();
    expect(f.adapter.submit).not.toHaveBeenCalled();
  });
});
