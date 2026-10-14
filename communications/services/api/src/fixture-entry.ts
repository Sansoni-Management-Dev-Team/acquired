import { createCommunicationsServer } from "./server";
import { assertOperationMatches, type AccessScope, type ConnectionRecord, type DeliveryOutcome, type OperationSnapshot } from "../../../packages/contracts/src/index";

// Explicit fixture startup only. No environment credential reading or provider dependencies.
if (!process.argv.includes("--fixture")) throw new Error("Synthetic entry requires --fixture");
function argument(name: string, fallback: string) {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
}
const port = Number(argument("--port", "4044"));
const host = argument("--host", "127.0.0.1");
if (!Number.isSafeInteger(port) || port < 1 || port > 65535 || !["127.0.0.1", "0.0.0.0"].includes(host)) throw new Error("Invalid synthetic listener");
const scope: AccessScope = { applicationId: "fixture-app", tenantId: "fixture-tenant", ownerId: "fixture-owner" };
const connection: ConnectionRecord = {
  binding: { ...scope, connectionId: "fixture-connection", accountId: "fixture-account", generation: 1,
    channel: "whatsapp", platform: "whatsapp", backend: "baileys" },
  status: "connected", capabilities: { messaging: { send: true, durableIdempotency: false, receiptLookup: true },
    events: { read: false, history: false, realtime: false } },
};
const journal = new Map<string, { snapshot: OperationSnapshot; outcome: DeliveryOutcome }>();
const server = createCommunicationsServer({
  authorize: async (request) => request.headers.authorization === "Bearer fixture-only-service-key" ? scope : null,
  connections: { get: async (_trusted, id, generation) =>
    id === connection.binding.connectionId && generation === connection.binding.generation ? connection : null },
  resolveAdapter: async () => ({
    ready: async () => ({ status: "ready" }),
    submit: async (input) => {
      const previous = journal.get(input.snapshot.key);
      if (previous) {
        try { assertOperationMatches(previous.snapshot, input.snapshot); }
        catch { return { status: "review", code: "operation_conflict" }; }
        return previous.outcome;
      }
      const outcome: DeliveryOutcome = { status: "submitted", receipt: {
        message: { binding: input.snapshot.binding, id: `fixture-message-${journal.size + 1}` }, recipient: input.message.recipient,
      } };
      journal.set(input.snapshot.key, { snapshot: input.snapshot, outcome });
      return outcome;
    },
    lookup: async (input) => {
      const previous = journal.get(input.snapshot.key);
      if (!previous) return null;
      assertOperationMatches(previous.snapshot, input.snapshot);
      return previous.outcome;
    },
  }),
});
server.listen(port, host, () => {
  process.stdout.write(JSON.stringify({ fixture: true, contractVersion: "1", listening: true, port }) + "\n");
});
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
  server.closeAllConnections();
  server.close(() => process.exit(0));
});
