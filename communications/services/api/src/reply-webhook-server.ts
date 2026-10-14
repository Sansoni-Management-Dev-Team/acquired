import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { ReplyIngress, WebhookIngressResult } from "../../../packages/core/src/reply-ingress";

export interface ReplyWebhookServerDependencies {
  /** Ingress must reauthenticate and resolve capture only after its durable receipt transaction commits. */
  ingress: ReplyIngress;
  maxRequestBytes?: number;
  bodyTimeoutMs?: number;
  /** Provider acknowledgement must remain under 30 seconds, including body ingestion. */
  captureTimeoutMs?: number;
}

class RequestFailure extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

function respond(response: ServerResponse, status: number, body: object) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, {
    "Content-Type": "application/json", "Cache-Control": "no-store", "Connection": "close",
  });
  response.end(JSON.stringify(body));
}

function readRawBody(request: IncomingMessage, maxBytes: number, timeoutMs: number): Promise<Uint8Array> {
  let contentTypeCount = 0;
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === "content-type") contentTypeCount += 1;
  }
  if (contentTypeCount !== 1) throw new RequestFailure(400, "invalid_request");
  const contentType = request.headers["content-type"];
  if (typeof contentType !== "string" ||
      !/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(contentType)) {
    throw new RequestFailure(400, "invalid_request");
  }
  const declared = request.headers["content-length"];
  let expected: number | undefined;
  if (declared !== undefined) {
    if (typeof declared !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(declared)) throw new RequestFailure(400, "invalid_request");
    expected = Number(declared);
    if (!Number.isSafeInteger(expected) || expected > maxBytes) throw new RequestFailure(413, "too_large");
  }
  if (request.aborted || request.destroyed) throw new RequestFailure(400, "invalid_request");
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      request.off("data", data); request.off("end", end); request.off("error", error); request.off("aborted", aborted);
    };
    const fail = (failure: RequestFailure) => {
      if (settled) return;
      settled = true; cleanup(); chunks.length = 0; request.resume(); reject(failure);
    };
    const data = (chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (bytes > maxBytes) { fail(new RequestFailure(413, "too_large")); return; }
      // Own the received bytes; downstream ingress receives the exact original encoded payload.
      chunks.push(Buffer.from(chunk));
    };
    const end = () => {
      if (settled) return;
      if (expected !== undefined && bytes !== expected) { fail(new RequestFailure(400, "invalid_request")); return; }
      settled = true; cleanup(); resolve(Buffer.concat(chunks, bytes));
    };
    const error = () => fail(new RequestFailure(400, "invalid_request"));
    const aborted = () => fail(new RequestFailure(400, "invalid_request"));
    const timer = setTimeout(() => fail(new RequestFailure(408, "request_timeout")), timeoutMs);
    request.on("data", data); request.on("end", end); request.on("error", error); request.on("aborted", aborted);
  });
}

function validatedResult(value: unknown): WebhookIngressResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  // Accessor/proxy failures are handled by the enclosing request guard; never serialize a provider object.
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some(key => typeof key !== "string" || !("value" in descriptors[key]!))) return null;
  const status = descriptors.status?.value;
  const keys = Object.keys(descriptors).sort().join(",");
  if (keys === "status" && (status === "accepted" || status === "duplicate" || status === "retry")) return { status };
  const code = descriptors.code?.value;
  if (keys === "code,status" && status === "rejected" &&
      ["unauthorized", "invalid_request", "too_large", "forbidden"].includes(code)) {
    return { status: "rejected", code };
  }
  return null;
}

/** Dedicated provider webhook listener. No parsing, account routing, provider writes or storage fallback. */
export function createReplyWebhookServer(deps: ReplyWebhookServerDependencies) {
  const maxRequestBytes = deps.maxRequestBytes ?? 262_144;
  const bodyTimeoutMs = deps.bodyTimeoutMs ?? 5_000;
  const captureTimeoutMs = deps.captureTimeoutMs ?? 20_000;
  if (!Number.isSafeInteger(maxRequestBytes) || maxRequestBytes < 1 || maxRequestBytes > 1_048_576 ||
      !Number.isSafeInteger(bodyTimeoutMs) || bodyTimeoutMs < 1 ||
      !Number.isSafeInteger(captureTimeoutMs) || captureTimeoutMs < 1 ||
      bodyTimeoutMs + captureTimeoutMs >= 30_000 ||
      typeof deps.ingress?.authenticate !== "function" || typeof deps.ingress?.capture !== "function") {
    throw new Error("Invalid reply webhook server configuration");
  }
  const ingress = Object.freeze({ ...deps.ingress, authenticate: deps.ingress.authenticate, capture: deps.ingress.capture });
  const authenticate = deps.ingress.authenticate.bind(ingress);
  const capture = deps.ingress.capture.bind(ingress);
  const server = createServer((request, response) => {
    void (async () => {
      if (request.method !== "POST" || request.url !== "/v1/webhook") throw new RequestFailure(404, "not_found");
      const rawHeaders = Object.freeze([...request.rawHeaders]);
      if (authenticate(rawHeaders) !== true) throw new RequestFailure(401, "unauthorized");
      const rawBody = await readRawBody(request, maxRequestBytes, bodyTimeoutMs);
      // Reauthentication, scope/generation checks and durable receipt commit belong to ingress.
      let timer: ReturnType<typeof setTimeout> | undefined;
      let captured: unknown;
      try {
        captured = await Promise.race([
          capture({ rawHeaders, rawBody }),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new RequestFailure(503, "retry")), captureTimeoutMs);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      // A timeout never cancels or declares failure of the storage transaction. Late completion remains
      // durably deduplicated on provider retry and cannot produce a second or successful response here.
      const result = validatedResult(captured);
      if (!result || result.status === "retry") throw new RequestFailure(503, "retry");
      if (result.status === "rejected") {
        const status = { unauthorized: 401, invalid_request: 400, too_large: 413, forbidden: 403 }[result.code];
        throw new RequestFailure(status, result.code);
      }
      respond(response, 200, { status: result.status });
    })().catch((error: unknown) => {
      request.resume();
      if (error instanceof RequestFailure) respond(response, error.status, { error: { code: error.code } });
      else respond(response, 503, { error: { code: "retry" } });
    });
  });
  // Body and capture timing are enforced above; timeout never fabricates persistence success.
  server.requestTimeout = 0;
  server.headersTimeout = 10_000;
  return server;
}
