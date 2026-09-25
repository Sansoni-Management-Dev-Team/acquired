import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

// Deliberately in-memory and loopback-only via compose.local.yml. This server
// does not know how to contact Gmail, LinkedIn, WhatsApp, or any real provider.
const events = [];
const deliveries = [];
const failAfterAccept = new Set();
const failNextCheck = new Set();
const hideNextMessage = new Set();
const hiddenMessages = new Set();
const key = (mailboxId, email) => `${mailboxId}:${email.toLowerCase()}`;
const checkKey = (kind, mailboxId, email) => `${kind}:${key(mailboxId, email)}`;

function send(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

async function body(request) {
  let source = "";
  for await (const chunk of request) {
    source += chunk;
    if (source.length > 1_000_000) throw new Error("Payload too large");
  }
  return JSON.parse(source || "{}");
}

createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", "http://localhost");
    const mailboxId = url.searchParams.get("mailboxId") || "";
    const email = (url.searchParams.get("email") || "").toLowerCase();
    const since = Date.parse(url.searchParams.get("since") || "1970-01-01T00:00:00Z");
    const matching = () => events.filter(event => event.mailboxId === mailboxId && event.email === email);
    if (request.method === "GET" && url.pathname === "/health") return send(response, 200, { ok: true, mode: "no-external-delivery" });
    if (request.method === "POST" && url.pathname === "/__test/reset") {
      events.length = 0;
      deliveries.length = 0;
      failAfterAccept.clear();
      failNextCheck.clear();
      hideNextMessage.clear();
      hiddenMessages.clear();
      return send(response, 200, { ok: true });
    }
    if (request.method === "GET" && url.pathname === "/__test/deliveries") return send(response, 200, deliveries);
    if (request.method === "POST" && url.pathname === "/__test/event") {
      const input = await body(request);
      if (!input.mailboxId || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email) || !["inbound", "outbound"].includes(input.direction)) return send(response, 400, { error: "Invalid test event" });
      const event = { id: input.id || randomUUID(), mailboxId: input.mailboxId, email: input.email.toLowerCase(), direction: input.direction, at: input.at || new Date().toISOString(), messageId: input.messageId || null };
      events.push(event);
      return send(response, 201, event);
    }
    if (request.method === "POST" && url.pathname === "/__test/fail-next-send") {
      const input = await body(request);
      if (!input.mailboxId || !input.email) return send(response, 400, { error: "Missing mailbox or email" });
      failAfterAccept.add(key(input.mailboxId, input.email));
      return send(response, 200, { ok: true });
    }
    if (request.method === "POST" && url.pathname === "/__test/fail-next-check") {
      const input = await body(request);
      if (!input.mailboxId || !input.email || !["conversation", "inbound", "outbound"].includes(input.kind)) return send(response, 400, { error: "Invalid test check" });
      failNextCheck.add(checkKey(input.kind, input.mailboxId, input.email));
      return send(response, 200, { ok: true });
    }
    if (request.method === "POST" && url.pathname === "/__test/hide-next-message") {
      const input = await body(request);
      if (!input.mailboxId || !input.email) return send(response, 400, { error: "Missing mailbox or email" });
      hideNextMessage.add(key(input.mailboxId, input.email));
      return send(response, 200, { ok: true });
    }
    if (request.method === "POST" && url.pathname === "/__test/release-messages") {
      hiddenMessages.clear();
      return send(response, 200, { ok: true });
    }
    if (request.method === "GET" && ["/conversation", "/inbound", "/outbound"].includes(url.pathname) && failNextCheck.delete(checkKey(url.pathname.slice(1), mailboxId, email))) return send(response, 503, { error: "Simulated mailbox check outage" });
    if (request.method === "GET" && url.pathname === "/conversation") return send(response, 200, { existing: matching().length > 0 });
    if (request.method === "GET" && url.pathname === "/inbound") return send(response, 200, matching().filter(event => event.direction === "inbound" && Date.parse(event.at) >= since).map(event => ({ id: event.id, receivedAt: event.at })));
    if (request.method === "GET" && url.pathname === "/outbound") return send(response, 200, matching().filter(event => event.direction === "outbound" && Date.parse(event.at) >= since).map(event => event.id));
    if (request.method === "GET" && url.pathname === "/message") {
      if (hiddenMessages.has(url.searchParams.get("messageId"))) return send(response, 200, null);
      const delivery = deliveries.find(item => item.message.messageId === url.searchParams.get("messageId") && item.mailboxId === mailboxId);
      return send(response, 200, delivery ? { id: delivery.providerMessageId, threadId: delivery.providerThreadId } : null);
    }
    if (request.method === "POST" && url.pathname === "/send") {
      const input = await body(request);
      if (!input.mailboxId || !input.userId || !input.message?.messageId || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.message.to)) return send(response, 400, { error: "Invalid test send" });
      const sentAt = new Date().toISOString();
      const providerMessageId = randomUUID();
      const providerThreadId = randomUUID();
      const delivery = { channel: "email", mailboxId: input.mailboxId, userId: input.userId, message: input.message, providerMessageId, providerThreadId, sentAt };
      deliveries.push(delivery);
      events.push({ id: providerMessageId, mailboxId: input.mailboxId, email: input.message.to.toLowerCase(), direction: "outbound", at: sentAt, messageId: input.message.messageId });
      if (hideNextMessage.delete(key(input.mailboxId, input.message.to))) hiddenMessages.add(input.message.messageId);
      const failureKey = key(input.mailboxId, input.message.to);
      if (failAfterAccept.delete(failureKey)) return send(response, 503, { error: "Simulated response loss after acceptance" });
      return send(response, 200, { providerMessageId, providerThreadId, sentAt });
    }
    return send(response, 404, { error: "Not found" });
  } catch (error) {
    return send(response, 400, { error: error instanceof Error ? error.message : "Invalid request" });
  }
}).listen(8080, "0.0.0.0", () => console.log("Campaign no-send sink listening on 8080"));
