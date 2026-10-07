import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { requireDb } from "@/db/client";
import { mailboxConnections } from "@/db/schema";
import { decryptToken } from "@/lib/token-crypto";
import { checkGmailHealth, checkHostedHealth } from "@/lib/channel-health";
import { hasTrustedRequestOrigin } from "@/lib/request-origin";

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "Sign in to test your connection" }, { status: 401 });
  const organizationId = session.session.activeOrganizationId;
  if (!organizationId) return Response.json({ error: "Choose an organisation" }, { status: 403 });
  if (!hasTrustedRequestOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  const provider = new URL(request.url).searchParams.get("provider");
  if (!["gmail", "linkedin", "whatsapp"].includes(provider || "")) return Response.json({ error: "Unknown channel" }, { status: 400 });
  const headers = { "Cache-Control": "no-store" };
  try {
    if (provider !== "gmail") return Response.json(await checkHostedHealth(provider as "linkedin" | "whatsapp", { organizationId, userId: session.user.id }), { headers });
    const [connection] = await requireDb().select({ address: mailboxConnections.address, encryptedRefreshToken: mailboxConnections.encryptedRefreshToken, reconnectRequired: mailboxConnections.reconnectRequired }).from(mailboxConnections).where(and(eq(mailboxConnections.organizationId, organizationId), eq(mailboxConnections.userId, session.user.id), eq(mailboxConnections.provider, "gmail"))).limit(1);
    if (!connection?.encryptedRefreshToken || connection.reconnectRequired) return Response.json({ status: "attention", message: "Connect or reconnect Gmail to verify access.", checkedAt: new Date().toISOString() }, { headers });
    return Response.json(await checkGmailHealth(decryptToken(connection.encryptedRefreshToken), connection.address), { headers });
  } catch { return Response.json({ status: "unavailable", message: "This connection could not be checked. Try again shortly.", checkedAt: new Date().toISOString() }, { headers }); }
}
