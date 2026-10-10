import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { submitDelivery } from "./delivery.mjs";
const input = {
  key: "campaign:enrol:step",
  recipient: "61412345678@s.whatsapp.net",
  text: "Hello",
};
function fixture() {
  let sends = 0;
  const rows = new Map();
  return {
    rows,
    count: () => sends,
    auth: {
      deliveryFingerprint: (input) =>
        createHash("sha256").update(JSON.stringify(input)).digest("hex"),
      claimDelivery: async (account, key, hash) => {
        const old = rows.get(key);
        if (old) {
          if (old.hash !== hash || old.account !== account)
            return { status: "review", code: "account_changed" };
          return old.receipt || { status: "unknown" };
        }
        rows.set(key, { account, hash });
        return { status: "claimed" };
      },
      completeDelivery: async (key, result) => {
        rows.get(key).receipt = result;
      },
      markDeliveryUnknown: async () => {},
    },
    socket: {
      sendMessage: async (recipient) => {
        sends++;
        return { key: { id: "provider-id", remoteJid: recipient } };
      },
    },
  };
}
test("concurrent service replays and restarts return one durable receipt without another submission", async () => {
  const f = fixture();
  const first = await Promise.all(
    Array.from({ length: 5 }, () =>
      submitDelivery(f.auth, f.socket, "account", input),
    ),
  );
  assert.equal(f.count(), 1);
  assert.equal(first.filter((r) => r.status === "submitted").length, 1);
  assert.equal(
    (await submitDelivery(f.auth, f.socket, "account", input)).status,
    "submitted",
  );
  assert.equal(f.count(), 1);
  assert.equal(
    (
      await submitDelivery(f.auth, f.socket, "account", {
        ...input,
        text: "Changed",
      })
    ).status,
    "review",
  );
  assert.equal(f.count(), 1);
  assert.equal(
    (await submitDelivery(f.auth, f.socket, "different-account", input)).status,
    "review",
  );
  assert.equal(f.count(), 1);
});
test("lost provider responses and failed receipt commits never repeat a possibly accepted send", async () => {
  for (const stage of ["provider", "database"]) {
    const f = fixture();
    if (stage === "provider")
      f.socket.sendMessage = async () => {
        throw Error("lost response");
      };
    else
      f.auth.completeDelivery = async () => {
        throw Error("lost database response");
      };
    assert.equal(
      (await submitDelivery(f.auth, f.socket, "account", input)).status,
      "unknown",
    );
    assert.equal(
      (await submitDelivery(f.auth, f.socket, "account", input)).status,
      "unknown",
    );
  }
});
test("a capacity wait cannot call the provider", async () => {
  const f = fixture();
  f.auth.claimDelivery = async () => ({
    status: "waiting",
    retryAt: "2030-01-01T00:00:00.000Z",
    code: "rate_limited",
  });
  assert.equal(
    (await submitDelivery(f.auth, f.socket, "account", input)).status,
    "waiting",
  );
  assert.equal(f.count(), 0);
});
test("an unexpected receipt recipient cannot be recorded as a successful delivery", async () => {
  const f = fixture();
  f.socket.sendMessage = async () => ({
    key: { id: "other-receipt", remoteJid: "61499999999@s.whatsapp.net" },
  });
  assert.equal(
    (await submitDelivery(f.auth, f.socket, "account", input)).status,
    "unknown",
  );
  assert.equal(
    (await submitDelivery(f.auth, f.socket, "account", input)).status,
    "unknown",
  );
});
test("a mapped LID receipt verifies the same recipient before committing", async () => {
  const f = fixture();
  f.socket.sendMessage = async () => ({
    key: { id: "receipt", remoteJid: "12345@lid" },
  });
  f.socket.signalRepository = {
    lidMapping: { getPNForLID: async () => input.recipient },
  };
  assert.equal(
    (await submitDelivery(f.auth, f.socket, "account", input)).status,
    "submitted",
  );
});
