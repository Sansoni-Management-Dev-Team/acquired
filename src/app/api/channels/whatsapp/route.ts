import { auth } from "@/lib/auth";
import { hasTrustedRequestOrigin } from "@/lib/request-origin";

async function proxy(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "Sign in to connect WhatsApp" }, { status: 401 });
  const organizationId = session.session.activeOrganizationId;
  if (!organizationId) return Response.json({ error: "Choose an organisation" }, { status: 403 });
  if (request.method !== "GET" && !hasTrustedRequestOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  const base = process.env.WHATSAPP_SERVICE_URL;
  const secret = process.env.WHATSAPP_SERVICE_SECRET;
  if (!base || !secret) return Response.json({ error: "WhatsApp connection service is not configured", status: "unavailable" }, { status: 503 });
  const url = new URL("/connection", base);
  url.searchParams.set("organizationId", organizationId);
  url.searchParams.set("userId", session.user.id);
  try {
    const response = await fetch(url, { method: request.method, headers: { Authorization: `Bearer ${secret}` }, cache: "no-store", signal: AbortSignal.timeout(15000) });
    const data = await response.json();
    // Explicit allowlist: provider secrets must never cross into browser responses.
    return Response.json({ status: data.status, address: data.address, qr: data.qr, error: data.error }, { status: response.status, headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "WhatsApp connection service is unavailable" }, { status: 503 }); }
}
export const GET = proxy;
export const POST = proxy;
export const DELETE = proxy;
