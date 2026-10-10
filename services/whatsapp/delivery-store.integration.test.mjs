import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import pg from "pg";
import { createStore } from "./store.mjs";
import { submitDelivery } from "./delivery.mjs";

test(
  "isolated Postgres journal: concurrent submission, encrypted restart receipt, quotas and tenant isolation",
  { skip: process.env.WHATSAPP_DELIVERY_DB_TEST !== "true" },
  async () => {
    const url = new URL(process.env.DATABASE_URL);
    assert.equal(url.pathname, "/acquire_channels");
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "5445");
    const admin = new pg.Client({ connectionString: url.toString() });
    await admin.connect();
    const id = `wa-delivery-test-${randomUUID()}`,
      other = `wa-delivery-test-${randomUUID()}`;
    const actor = { organizationId: id, userId: id };
    const env = {
      DATABASE_URL: url.toString(),
      WHATSAPP_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      WHATSAPP_CAMPAIGNS_ENABLED: "true",
      WHATSAPP_CAMPAIGN_HOURLY_CAP: "2",
      WHATSAPP_CAMPAIGN_DAILY_CAP: "2",
      WHATSAPP_CAMPAIGN_SPACING_MS: "1000",
    };
    const store = createStore(env),
      replacement = createStore(env);
    let auth;
    let calls = 0;
    const socket = {
      sendMessage: async (recipient) => {
        calls++;
        return {
          key: { id: "private-provider-receipt", remoteJid: recipient },
        };
      },
    };
    const input = {
      key: "campaign:enrol:step",
      recipient: "61412345678@s.whatsapp.net",
      text: "Private message never persisted",
    };
    try {
      await store.health();
      await admin.query(
        'INSERT INTO "user" (id,name,email) VALUES ($1,$1,$2),($3,$3,$4)',
        [id, `${id}@example.invalid`, other, `${other}@example.invalid`],
      );
      await admin.query(
        "INSERT INTO organization (id,name,slug) VALUES ($1,$1,$1)",
        [id],
      );
      await admin.query(
        "INSERT INTO member (id,organization_id,user_id) VALUES ($1,$2,$2),($3,$2,$4)",
        [randomUUID(), id, randomUUID(), other],
      );
      auth = await store.open(actor);
      await auth.update("connected", "61400000001");
      const account = `${auth.connectionId}:61400000001@s.whatsapp.net`;
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          submitDelivery(auth, socket, account, input),
        ),
      );
      assert.equal(calls, 1);
      assert.ok(results.some((r) => r.status === "submitted"));
      const saved = (
        await admin.query(
          "SELECT * FROM whatsapp_delivery_actions WHERE connection_id=$1",
          [auth.connectionId],
        )
      ).rows[0];
      assert.equal(saved.state, "submitted");
      assert.ok(!JSON.stringify(saved).includes("private-provider-receipt"));
      assert.ok(!JSON.stringify(saved).includes(input.text));
      assert.equal(
        (await store.readDelivery(actor, input.key)).status,
        "submitted",
      );
      assert.equal(
        (
          await store.readDelivery(
            { organizationId: id, userId: other },
            input.key,
          )
        ).status,
        "missing",
      );
      await auth.close();
      auth = await replacement.open(actor);
      assert.equal(
        (await submitDelivery(auth, socket, account, input)).status,
        "submitted",
      );
      assert.equal(calls, 1);
      assert.equal(
        (
          await submitDelivery(auth, socket, account, {
            ...input,
            text: "Changed",
          })
        ).status,
        "review",
      );
      assert.equal(calls, 1);
      await admin.query(
        "UPDATE whatsapp_delivery_actions SET claimed_at=now()-interval '2 minutes' WHERE connection_id=$1",
        [auth.connectionId],
      );
      assert.equal(
        (
          await submitDelivery(auth, socket, account, {
            ...input,
            key: "campaign:enrol:second",
          })
        ).status,
        "submitted",
      );
      const waited = await submitDelivery(auth, socket, account, {
        ...input,
        key: "campaign:enrol:third",
      });
      assert.equal(waited.status, "waiting");
      assert.equal(waited.code, "rate_limited");
      assert.equal(calls, 2);
      await auth.update("connected", "61499999999");
      assert.equal(
        (await replacement.readDelivery(actor, input.key)).code,
        "account_changed",
      );
      const table = (
        await admin.query(
          "SELECT relrowsecurity FROM pg_class WHERE relname='whatsapp_delivery_actions'",
        )
      ).rows[0];
      assert.equal(table.relrowsecurity, true);
      await admin.query("BEGIN");
      try {
        await admin.query("SET LOCAL ROLE acquire_campaign_user");
        await assert.rejects(
          admin.query("SELECT * FROM whatsapp_delivery_actions"),
          (e) => e.code === "42501",
        );
      } finally {
        await admin.query("ROLLBACK");
      }
    } finally {
      await auth?.close();
      await store.close();
      await replacement.close();
      await admin.query("DELETE FROM organization WHERE id=$1", [id]);
      await admin.query('DELETE FROM "user" WHERE id=ANY($1)', [[id, other]]);
      await admin.end();
    }
  },
);
