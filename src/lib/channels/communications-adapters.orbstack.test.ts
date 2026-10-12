import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import pg from "pg";
vi.mock("server-only", () => ({}));
import { acquireLegacyAdapter } from "./communications-adapters";
import type { ConnectionRecord, MessageSubmission } from "../../../communications/packages/contracts/src/index";
import { messageDigest } from "../../../communications/packages/core/src/message-digest";

// Existing approved isolated schema and real service/session/journal, synthetic socket only.
describe.skipIf(process.env.COMMUNICATIONS_ORBSTACK_LEGACY !== "1")("communications wrapper with OrbStack WhatsApp fixture", () => {
  const reader = "http://127.0.0.1:18125";
  const secret = "isolated-channel-fixture-secret-32chars";
  const suffix = randomUUID();
  const actor = { organizationId: `communications-fixture-${suffix}`, userId: `communications-fixture-${suffix}` };
  const db = new pg.Client({ connectionString: "postgresql://acquire_channels:isolated-channel-tests-only@127.0.0.1:5445/acquire_channels", connectionTimeoutMillis: 5000 });
  const record: ConnectionRecord = { binding: { applicationId: "acquire", tenantId: actor.organizationId, ownerId: actor.userId, connectionId: `communications-fixture-${suffix}`, accountId: "fixture-whatsapp-61400000001", generation: 1, channel: "whatsapp", platform: "whatsapp", backend: "baileys" }, status: "connected", capabilities: { messaging: { send: true, durableIdempotency: true, receiptLookup: true }, events: { read: false, history: false, realtime: false } } };
  const message = { recipient: { kind: "phone" as const, value: "+61400000002" }, text: `Synthetic communications wrapper ${suffix}` };
  const submission: MessageSubmission = { snapshot: { binding: record.binding, key: `communications:${suffix}`, operation: "message", payloadDigest: messageDigest("message", message) }, message };
  let connected = false;
  async function provider(path: string, method = "GET") {
    const url = new URL(path, reader);
    url.search = new URLSearchParams({ organizationId: actor.organizationId, userId: actor.userId }).toString();
    const response = await fetch(url, { method, headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(5000) });
    expect(response.ok).toBe(true);
    return response.json();
  }
  beforeAll(async () => {
    const id = execFileSync("docker", ["--context", "orbstack", "compose", "-f", "ops/channel-services.compose.yml", "ps", "-q", "whatsapp-fixture"], { encoding: "utf8" }).trim();
    const container = JSON.parse(execFileSync("docker", ["--context", "orbstack", "inspect", id], { encoding: "utf8" }))[0];
    expect(container.Config.Labels["com.docker.compose.project"]).toBe("acquire-channel-services");
    expect(container.Config.Env).toContain("WHATSAPP_ISOLATED_FIXTURE=true");
    await db.connect();
    expect((await db.query("SELECT current_database() name")).rows[0].name).toBe("acquire_channels");
    expect((await db.query("SELECT to_regclass('public.whatsapp_delivery_actions') name")).rows[0].name).toBeTruthy();
    await db.query("BEGIN");
    try {
      await db.query('INSERT INTO "user" (id,name,email,email_verified,created_at,updated_at) VALUES ($1,$1,$2,false,now(),now())', [actor.userId, `${actor.userId}@example.invalid`]);
      await db.query("INSERT INTO organization (id,name,slug) VALUES ($1,$1,$1)", [actor.organizationId]);
      await db.query("INSERT INTO member (id,organization_id,user_id,role) VALUES ($1,$2,$3,'owner')", [randomUUID(), actor.organizationId, actor.userId]);
      await db.query("COMMIT");
    } catch (error) { await db.query("ROLLBACK"); throw error; }
    vi.stubEnv("WHATSAPP_SERVICE_URL", reader);
    vi.stubEnv("WHATSAPP_SERVICE_SECRET", secret);
    vi.stubEnv("UNIPILE_API_KEY", "");
    await provider("/connection", "POST");
    connected = true;
    for (let i = 0; i < 30; i++) {
      if ((await provider("/connection")).status === "connected") return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error("Synthetic WhatsApp connection did not become ready");
  });
  afterAll(async () => {
    try {
      if (connected) await provider("/connection", "DELETE");
      await db.query("DELETE FROM whatsapp_connections WHERE organization_id=$1", [actor.organizationId]);
      await db.query("DELETE FROM member WHERE organization_id=$1", [actor.organizationId]);
      await db.query("DELETE FROM organization WHERE id=$1", [actor.organizationId]);
      await db.query('DELETE FROM "user" WHERE id=$1', [actor.userId]);
    } finally { await db.end(); vi.unstubAllEnvs(); }
  });
  it("submits through the new wrapper, replays the actual journal and performs lookup with one provider-side message", async () => {
    const adapter = acquireLegacyAdapter(actor, record);
    const original = await adapter.submit(submission);
    expect(original).toMatchObject({ status: "submitted", receipt: { message: { binding: record.binding }, recipient: message.recipient } });
    expect(await adapter.submit(submission)).toEqual(original);
    const recovered = await acquireLegacyAdapter(actor, { ...record, status: "disconnected" }).lookup({ snapshot: submission.snapshot, expectedRecipient: message.recipient });
    expect(recovered).toMatchObject({ status: "submitted", receipt: { message: { binding: record.binding }, recipient: message.recipient } });
    expect(recovered).not.toHaveProperty("receipt.submittedAt");
    const receipts = await (await fetch(`${reader}/__test/receipts`, { headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(5000) })).json() as { text: string }[];
    expect(receipts.filter(receipt => receipt.text === message.text)).toHaveLength(1);
  });
  it("rejects an unauthorized actor and changed account before any fixture dispatch", async () => {
    expect(() => acquireLegacyAdapter({ ...actor, userId: "foreign-owner" }, record)).toThrow("forbidden");
    await expect(acquireLegacyAdapter(actor, record).submit({ ...submission, snapshot: { ...submission.snapshot, binding: { ...record.binding, accountId: "foreign-account" } } })).rejects.toThrow("binding_changed");
  });
});
