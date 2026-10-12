import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  COMMUNICATIONS_CONTRACT_VERSION, ContractError, assertSubmissionReceiptMatches, assertSameBinding,
  resolveRecordedConnection, type AccessScope, type ConnectionRecord,
  type DeliveryOutcome, type MessagingAdapter, type OperationSnapshot, type CanonicalIdentity, type ProviderReference,
} from "../../../packages/contracts/src/index";
import { messageDigest } from "../../../packages/core/src/message-digest";
import { isDeliveryOutcome, isReadiness } from "../../../packages/sdk/src/validation";
import { InvalidRequest, parseLookup, parseReady, parseSubmission } from "./schema";

export interface CommunicationsServerDependencies {
  /** Authenticate independently of body claims; returning null rejects the caller. */
  authorize(request: IncomingMessage): Promise<AccessScope | null>;
  /** Exact immutable generation only. Historical generations must be disconnected/read-only. */
  connections: { get(scope: AccessScope, connectionId: string, generation: number): Promise<ConnectionRecord | null> };
  resolveAdapter(connection: ConnectionRecord, scope: AccessScope): Promise<MessagingAdapter>;
  maxRequestBytes?: number;
  bodyTimeoutMs?: number;
}

class HttpError extends Error { constructor(readonly status: number, readonly code: string) { super(code); } }

function respond(response: ServerResponse, status: number, data: unknown) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store",
    "X-Communications-Contract-Version": COMMUNICATIONS_CONTRACT_VERSION });
  response.end(JSON.stringify(data));
}

async function readBody(request: IncomingMessage, maxBytes: number, timeoutMs: number): Promise<unknown> {
  if (request.headers["content-type"]?.split(";")[0].trim().toLowerCase() !== "application/json") throw new InvalidRequest();
  const declared = request.headers["content-length"];
  if (declared && Number(declared) > maxBytes) throw new HttpError(413, "request_too_large");
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    const cleanup = () => { clearTimeout(timer); request.off("data", data); request.off("end", end); request.off("error", error); request.off("aborted", aborted); };
    const fail = (reason: Error) => { cleanup(); request.resume(); reject(reason); };
    const data = (chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (bytes > maxBytes) { fail(new HttpError(413, "request_too_large")); return; }
      chunks.push(chunk);
    };
    const end = () => {
      cleanup();
      try { resolve(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)))); }
      catch { reject(new InvalidRequest()); }
    };
    const error = () => fail(new InvalidRequest());
    const aborted = () => fail(new InvalidRequest());
    const timer = setTimeout(() => fail(new HttpError(408, "request_timeout")), timeoutMs);
    request.on("data", data); request.on("end", end); request.on("error", error); request.on("aborted", aborted);
  });
}

function checkReceipt(snapshot: OperationSnapshot, outcome: DeliveryOutcome | null, recipient?: CanonicalIdentity, expectedMessage?: ProviderReference) {
  if (outcome?.status !== "submitted") return;
  // The authoritative adapter/journal verifies recipient when the caller supplies no correlation identity.
  assertSubmissionReceiptMatches(snapshot, recipient ?? outcome.receipt.recipient, outcome.receipt);
  if (expectedMessage && (!("message" in outcome.receipt) || outcome.receipt.message.id !== expectedMessage.id)) {
    throw new ContractError("receipt_mismatch");
  }
}

export function createCommunicationsServer(dependencies: CommunicationsServerDependencies) {
  const maxRequestBytes = dependencies.maxRequestBytes ?? 262_144;
  const bodyTimeoutMs = dependencies.bodyTimeoutMs ?? 5000;
  if (!Number.isSafeInteger(maxRequestBytes) || maxRequestBytes < 1 || maxRequestBytes > 1_048_576 ||
      !Number.isSafeInteger(bodyTimeoutMs) || bodyTimeoutMs < 1 || bodyTimeoutMs > 60_000) {
    throw new Error("Invalid communications server configuration");
  }
  const server = createServer((request, response) => {
    void (async () => {
      if (request.method === "GET" && request.url === "/health") {
        respond(response, 200, { contractVersion: COMMUNICATIONS_CONTRACT_VERSION }); return;
      }
      if (request.method !== "POST" || !["/v1/ready", "/v1/submit", "/v1/lookup"].includes(request.url ?? "")) {
        throw new HttpError(404, "not_found");
      }
      if (request.headers["x-communications-contract-version"] !== COMMUNICATIONS_CONTRACT_VERSION) {
        throw new HttpError(409, "contract_version");
      }
      const scope = await dependencies.authorize(request);
      if (!scope) throw new HttpError(401, "unauthorized");
      const body = await readBody(request, maxRequestBytes, bodyTimeoutMs);
      const ready = request.url === "/v1/ready" ? parseReady(body) : null;
      const submission = request.url === "/v1/submit" ? parseSubmission(body) : null;
      const lookup = request.url === "/v1/lookup" ? parseLookup(body) : null;
      const binding = ready ?? submission?.snapshot.binding ?? lookup!.snapshot.binding;
      if (binding.applicationId !== scope.applicationId || binding.tenantId !== scope.tenantId || binding.ownerId !== scope.ownerId) {
        throw new HttpError(403, "forbidden");
      }
      const current = await dependencies.connections.get(scope, binding.connectionId, binding.generation);
      const connection = resolveRecordedConnection(scope, binding, current ? [current] : []);
      if (submission) {
        if (submission.message.conversation) assertSameBinding(binding, submission.message.conversation.binding);
        if (messageDigest(submission.snapshot.operation, submission.message) !== submission.snapshot.payloadDigest) throw new ContractError("operation_conflict");
        if (submission.snapshot.operation === "invitation" &&
            (binding.channel !== "linkedin" || !connection.capabilities.linkedin?.invitations)) throw new HttpError(409, "unsupported");
        if (connection.status !== "connected" ||
            (submission.snapshot.operation === "message" && !connection.capabilities.messaging.send)) throw new ContractError("connection_unavailable");
      }
      if (lookup?.message) assertSameBinding(binding, lookup.message.binding);
      const adapter = await dependencies.resolveAdapter(connection, scope);
      if (ready) {
        const readiness = await adapter.ready(binding);
        if (!isReadiness(readiness)) throw new Error("Invalid adapter response");
        respond(response, 200, readiness); return;
      }
      if (lookup) {
        if (!connection.capabilities.messaging.receiptLookup) throw new HttpError(409, "unsupported");
        const outcome = await adapter.lookup(lookup);
        checkReceipt(lookup.snapshot, outcome, lookup.expectedRecipient, lookup.message);
        if (!isDeliveryOutcome(outcome, lookup.snapshot, lookup.expectedRecipient, lookup.message)) throw new Error("Invalid adapter response");
        respond(response, 200, outcome); return;
      }
      let outcome: DeliveryOutcome;
      try {
        outcome = await adapter.submit(submission!);
        checkReceipt(submission!.snapshot, outcome, submission!.message.recipient);
        if (!isDeliveryOutcome(outcome, submission!.snapshot, submission!.message.recipient) || outcome === null) throw new Error("Invalid adapter response");
      }
      catch { outcome = { status: "unknown" }; }
      respond(response, 200, outcome);
    })().catch((error: unknown) => {
      request.resume();
      if (error instanceof HttpError) respond(response, error.status, { error: { code: error.code } });
      else if (error instanceof InvalidRequest) respond(response, 400, { error: { code: "invalid_request" } });
      else if (error instanceof ContractError) respond(response, error.code === "forbidden" ? 403 : error.code === "invalid_binding" ? 400 : 409,
        { error: { code: error.code } });
      else respond(response, 500, { error: { code: "internal" } });
    });
  });
  server.requestTimeout = bodyTimeoutMs;
  server.headersTimeout = bodyTimeoutMs;
  return server;
}
