import { auth } from "@/lib/auth";
import { hasTrustedRequestOrigin } from "@/lib/request-origin";

const reads = new Set(["connection", "inbox", "settings", "queue"]);
const writes = new Set(["connection", "actions", "agent", "settings", "inbox"]);
async function proxy(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "Sign in to connect LinkedIn" }, { status: 401 });
  const organizationId = session.session.activeOrganizationId;
  if (!organizationId) return Response.json({ error: "Choose an organisation" }, { status: 403 });
  const incoming = new URL(request.url);
  if (request.method !== "GET" && !hasTrustedRequestOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  const operation = incoming.searchParams.get("op") || "connection";
  if (!(request.method === "GET" ? reads : writes).has(operation) || (request.method === "DELETE" && operation !== "connection")) return Response.json({ error: "Invalid operation" }, { status: 400 });
  const traceId = crypto.randomUUID().replaceAll("-", "");
  const base = process.env.LINKEDIN_SERVICE_URL;
  const secret = process.env.LINKEDIN_SERVICE_SECRET;
  if (!base || !secret) return Response.json({ error: "LinkedIn service is not configured", status: "unavailable" }, { status: 503, headers: { "X-LinkedIn-Trace-Id": traceId } });
  const url = new URL(`/${operation}`, base);
  url.searchParams.set("organizationId", organizationId);
  url.searchParams.set("userId", session.user.id);
  let body: string | undefined;
  if (request.method === "POST") {
    body = await request.text();
    if (body.length > 16384) return Response.json({ error: "Request too large" }, { status: 413 });
    try { JSON.parse(body); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  }
  const started = performance.now();
  const log = (event: string, fields: Record<string, unknown> = {}) => console.info(JSON.stringify({
    event, traceId, method: request.method, operation, ...fields,
  }));
  log("linkedin.service_request.start");
  try {
    const response = await fetch(url, { method: request.method, body, headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json", "X-LinkedIn-Trace-Id": traceId }, cache: "no-store", signal: AbortSignal.timeout(operation === "agent" ? 110000 : 55000) });
    const data = await response.json();
    log("linkedin.service_request.end", { durationMs: Math.round(performance.now()-started), httpStatus: response.status,
      sessionStatus: operation === "connection" && typeof data.status === "string" ? data.status : undefined,
      actionId: typeof data.action?.id === "string" && /^[a-f0-9]{32}$/.test(data.action.id) ? data.action.id : undefined,
      actionStatus: typeof data.action?.status === "string" ? data.action.status : undefined });
    // The service returns public status, viewer grants and requested content only.
    // Never relay provider cookies, browser storage state or service credentials.
    const allowed = ["status", "viewerUrl", "fixture", "inboxCaptured", "saved", "agentConfigured", "action", "response", "result", "error", "detail", "settings", "usage", "protection", "queue", "activity", "keepAlive", "cache"];
    const result = Object.fromEntries(allowed.filter(key => key in data).map(key => [key, data[key]]));
    if (data.detail && !data.error) result.error = typeof data.detail === "string" ? data.detail : "LinkedIn request failed";
    const headers: Record<string, string> = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-LinkedIn-Trace-Id": traceId };
    const retryAfter = response.headers.get("retry-after");
    if (retryAfter && /^\d+$/.test(retryAfter)) headers["Retry-After"] = retryAfter;
    return Response.json(result, { status: response.status, headers });
  } catch (error) {
    log("linkedin.service_request.error", { durationMs: Math.round(performance.now()-started), errorType: error instanceof Error ? error.name : "UnknownError" });
    return Response.json({ error: "LinkedIn service unavailable or operation timed out. Check status before retrying a send." }, { status: 503, headers: { "X-LinkedIn-Trace-Id": traceId } });
  }
}
export const GET = proxy;
export const POST = proxy;
export const DELETE = proxy;
