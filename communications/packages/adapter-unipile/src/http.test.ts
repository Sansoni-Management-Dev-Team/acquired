import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UnipileV2Transport } from "./http";

const fixtureKey = "synthetic-unipile-test-key";
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map((close) => close())); });

async function fixture(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  }));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture listener");
  return `http://127.0.0.1:${address.port}/v2`;
}

function transport(baseUrl: string, overrides = {}) {
  return new UnipileV2Transport({ apiVersion: "v2", baseUrl, apiKey: fixtureKey,
    allowLoopbackHttp: true, timeoutMs: 200, ...overrides });
}

describe("provisional Unipile v2 HTTP transport", () => {
  it("issues native account reads with explicit v2 path, secret header, fresh-cache policy and offset", async () => {
    const requests: { path: string; key: string | undefined; cache: string | undefined }[] = [];
    const baseUrl = await fixture((req, res) => {
      requests.push({ path: req.url!, key: req.headers["x-api-key"] as string,
        cache: req.headers["cache-control"] });
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(req.url?.includes("acc_") ? { id: "acc_fixture" }
        : { object: "Accounts", data: [], has_more: false }));
    });
    const client = transport(baseUrl);
    expect(await client.listAccounts({ offset: 20, limit: 10 })).toEqual({
      kind: "success", status: 200, data: { object: "Accounts", data: [], has_more: false },
    });
    expect(await client.getAccount("acc_fixture")).toMatchObject({ kind: "success", data: { id: "acc_fixture" } });
    expect(requests).toEqual([
      { path: "/v2/accounts/?offset=20&limit=10", key: fixtureKey, cache: "no-store" },
      { path: "/v2/accounts/acc_fixture", key: fixtureKey, cache: "no-store" },
    ]);
  });

  it("sends a native synthetic message exactly once with correctly encoded account/chat and payload", async () => {
    let calls = 0;
    let observed: unknown;
    const baseUrl = await fixture((req, res) => {
      calls++;
      let raw = "";
      req.on("data", (chunk) => { raw += chunk; });
      req.on("end", () => {
        observed = { path: req.url, method: req.method, body: JSON.parse(raw),
          contentType: req.headers["content-type"], key: req.headers["x-api-key"] };
        res.end('{"id":"message_fixture"}');
      });
    });
    expect(await transport(baseUrl).sendMessage("acc_fixture", "peer@lid", { text: "Fixture text" }))
      .toEqual({ kind: "success", status: 200, data: { id: "message_fixture" } });
    expect(calls).toBe(1);
    expect(observed).toEqual({ path: "/v2/acc_fixture/chats/peer%40lid/messages/send",
      method: "POST", body: { text: "Fixture text" }, contentType: "application/json", key: fixtureKey });
  });

  it.each([401, 403, 404, 422, 429])("classifies HTTP %i without disclosing provider details or retrying", async (status) => {
    let calls = 0;
    const baseUrl = await fixture((_req, res) => {
      calls++; res.statusCode = status; res.setHeader("Retry-After", "30");
      res.end(JSON.stringify({ title: fixtureKey, detail: "private message content" }));
    });
    const result = await transport(baseUrl).sendMessage("acc_fixture", "chat", { text: "Fixture" });
    expect(result).toMatchObject({ kind: "rejected", status });
    if (status === 429) expect(result).toHaveProperty("retryAfterSeconds", 30);
    expect(JSON.stringify(result)).not.toContain(fixtureKey);
    expect(JSON.stringify(result)).not.toContain("private message content");
    expect(calls).toBe(1);
  });

  it("keeps a lost response after submission unknown and never retries", async () => {
    let calls = 0;
    const baseUrl = await fixture((req) => {
      calls++; req.resume(); req.on("end", () => req.socket.destroy());
    });
    expect(await transport(baseUrl).sendMessage("acc_fixture", "chat", { text: "Fixture" }))
      .toEqual({ kind: "unknown", reason: "transport" });
    expect(calls).toBe(1);
  });

  it("distinguishes 5xx reads from uncertain submitted writes", async () => {
    let calls = 0;
    const baseUrl = await fixture((_req, res) => { calls++; res.statusCode = 503; res.end("Secret failure detail"); });
    const client = transport(baseUrl);
    expect(await client.getAccount("acc_fixture")).toEqual({ kind: "unavailable", reason: "provider_failure", status: 503 });
    expect(await client.sendMessage("acc_fixture", "chat", { text: "Fixture" }))
      .toEqual({ kind: "unknown", reason: "provider_failure", status: 503 });
    expect(calls).toBe(2);
  });

  it("bounds slow submissions and preserves uncertainty", async () => {
    let calls = 0;
    const baseUrl = await fixture((req) => { calls++; req.resume(); });
    expect(await transport(baseUrl, { timeoutMs: 25 }).sendMessage("acc_fixture", "chat", { text: "Fixture" }))
      .toEqual({ kind: "unknown", reason: "timeout" });
    expect(calls).toBe(1);
  });

  it("does not follow redirects or forward the key to another server", async () => {
    let redirected = 0;
    const destination = await fixture((_req, res) => { redirected++; res.end("{}"); });
    const baseUrl = await fixture((_req, res) => { res.statusCode = 302; res.setHeader("Location", destination); res.end(); });
    expect(await transport(baseUrl).getAccount("acc_fixture")).toMatchObject({ kind: "unavailable" });
    expect(redirected).toBe(0);
  });

  it("scrubs injected transport errors and disables injected automatic redirects", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error(fixtureKey));
    const client = transport("https://api.unipile.com/v2", { fetch: fetcher });
    expect(await client.getAccount("acc_fixture")).toEqual({ kind: "unavailable", reason: "transport" });
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: "error" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(client)).not.toContain(fixtureKey);
  });

  it("bounds an injected fetch that ignores cancellation", async () => {
    const fetcher = vi.fn(() => new Promise<Response>(() => {}));
    expect(await transport("https://api.unipile.com/v2", { fetch: fetcher, timeoutMs: 10 })
      .getAccount("acc_fixture")).toEqual({ kind: "unavailable", reason: "timeout" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("never dispatches an already canceled operation and preserves in-flight uncertainty", async () => {
    const fetcher = vi.fn(() => new Promise<Response>(() => {}));
    const client = transport("https://api.unipile.com/v2", { fetch: fetcher });
    const alreadyCanceled = AbortSignal.abort();
    expect(await client.sendMessage("acc_fixture", "chat", { text: "Fixture" }, { signal: alreadyCanceled }))
      .toEqual({ kind: "not_submitted", reason: "canceled" });
    expect(fetcher).not.toHaveBeenCalled();
    const controller = new AbortController();
    const pending = client.sendMessage("acc_fixture", "chat", { text: "Fixture" }, { signal: controller.signal });
    controller.abort();
    expect(await pending).toEqual({ kind: "unknown", reason: "canceled" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("bounds response bytes and classifies malformed accepted bodies as unknown", async () => {
    const baseUrl = await fixture((_req, res) => res.end("x".repeat(100)));
    expect(await transport(baseUrl, { maxResponseBytes: 20 }).getAccount("acc_fixture"))
      .toEqual({ kind: "unavailable", reason: "invalid_response" });
    expect(await transport(baseUrl).sendMessage("acc_fixture", "chat", { text: "Fixture" }))
      .toEqual({ kind: "unknown", reason: "invalid_response" });
  });

  it.each([
    "http://api.unipile.com/v2", "https://user:password@api.unipile.com/v2",
    "https://api.unipile.com/v2?key=bad", "https://api.unipile.com/v2#fragment",
    "https://api.unipile.com/api/v1", "http://127.0.0.1.attacker.invalid/v2",
  ])("rejects unsafe or wrong-version base URL %s", (baseUrl) => {
    expect(() => transport(baseUrl)).toThrow("Invalid Unipile configuration");
  });

  it("requires explicit version and loopback opt-in", () => {
    expect(() => transport("https://api.unipile.com/v2", { apiVersion: undefined })).toThrow();
    expect(() => transport("https://api.unipile.com/v2", { apiVersion: "v1" })).toThrow();
    expect(() => transport("http://127.0.0.1/v2", { allowLoopbackHttp: false })).toThrow();
    expect(() => transport("https://api.unipile.com/v2", { timeoutMs: 0 })).toThrow();
  });

  it("rejects path traversal and invalid pagination before any request", async () => {
    const fetcher = vi.fn();
    const client = transport("https://api.unipile.com/v2", { fetch: fetcher });
    await expect(client.getAccount("../accounts")).rejects.toThrow("Invalid Unipile request");
    await expect(client.sendMessage("acc_fixture", "..", { text: "Fixture" })).rejects.toThrow();
    await expect(client.listAccounts({ offset: -1 })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
