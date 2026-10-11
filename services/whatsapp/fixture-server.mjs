// Separately owned OrbStack fixture. The production entry point never imports it.
import { EventEmitter } from "node:events";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createStore } from "./store.mjs";
import { Sessions } from "./sessions.mjs";
import { serviceServer } from "./http.mjs";
const db = new URL(
  process.env.DATABASE_URL || "postgresql://invalid.invalid/invalid",
);
if (
  process.env.WHATSAPP_ISOLATED_FIXTURE !== "true" ||
  db.hostname !== "postgres" ||
  db.pathname !== "/acquire_channels" ||
  process.env.WHATSAPP_CAMPAIGNS_ENABLED !== "true"
)
  throw Error("Requires the isolated channel-stack database and fixture flag");
const store = createStore(process.env);
const directory = "/fixture-data";
mkdirSync(directory, { recursive: true });
const journal = `${directory}/provider-receipts.json`;
const receipts = () => {
  try {
    return JSON.parse(readFileSync(journal, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
};
const socketFactory = (options) => {
  const socket = {
    ev: new EventEmitter(),
    user: { id: "61400000001@s.whatsapp.net" },
    end() {},
    logout: async () => {},
    sendMessage: async (recipient, message) => {
      const saved = receipts();
      const id = `fixture-${saved.length + 1}`;
      saved.push({ id, recipient, text: message.text });
      writeFileSync(journal, JSON.stringify(saved), { mode: 0o600 });
      return { key: { id, remoteJid: recipient } };
    },
  };
  options.auth.creds.registered = true;
  options.auth.creds.me = { id: socket.user.id };
  setImmediate(() =>
    socket.ev.emit("connection.update", {
      connection: "open",
      receivedPendingNotifications: true,
    }),
  );
  return socket;
};
const sessions = new Sessions(store, socketFactory);
const server = serviceServer(
  store,
  sessions,
  process.env.WHATSAPP_SERVICE_SECRET,
);
// Test assertions read provider-side evidence; all mutation paths remain real service routes.
const handler = server.listeners("request")[0];
server.removeAllListeners("request");
server.on("request", async (request, response) => {
  if (request.url === "/__test/receipts" && request.method === "GET") {
    if (
      request.headers.authorization !==
      `Bearer ${process.env.WHATSAPP_SERVICE_SECRET}`
    ) {
      response.writeHead(401).end();
      return;
    }
    response
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify(receipts()));
    return;
  }
  const url = new URL(request.url, "http://fixture.invalid");
  if (url.pathname === "/__test/inbound" && request.method === "POST") {
    if (
      request.headers.authorization !==
      `Bearer ${process.env.WHATSAPP_SERVICE_SECRET}`
    ) {
      response.writeHead(401).end();
      return;
    }
    try {
      const actor = {
        organizationId: url.searchParams.get("organizationId"),
        userId: url.searchParams.get("userId"),
      };
      await store.authorize(actor);
      const session = sessions.sessions.get(sessions.key(actor));
      if (!session || session.status !== "connected")
        throw Error("Fixture account unavailable");
      let raw = "";
      for await (const chunk of request) {
        raw += chunk;
        if (raw.length > 16384) throw Error("Too large");
      }
      const data = JSON.parse(raw);
      if (!/^[1-9]\d{6,14}@s\.whatsapp\.net$/.test(data.recipient))
        throw Error("Invalid recipient");
      session.socket.ev.emit("messages.upsert", {
        messages: [
          {
            key: {
              id: `inbound-${Date.now()}`,
              remoteJid: data.recipient,
              fromMe: false,
            },
            messageTimestamp: Date.now() / 1000,
            message: { conversation: "Synthetic reply" },
          },
        ],
      });
      await session.events;
      response
        .writeHead(200, { "content-type": "application/json" })
        .end('{"ok":true}');
    } catch {
      response.writeHead(400).end();
    }
    return;
  }
  void handler(request, response);
});
await store.health();
await sessions.reconcile();
server.listen(8080, "0.0.0.0");
async function stop() {
  await sessions.stop();
  await store.close();
  server.close(() => process.exit(0));
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
