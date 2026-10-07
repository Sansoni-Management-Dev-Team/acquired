import { refreshGoogleAccessToken } from "@/lib/google-oauth";

type HealthStatus = "healthy" | "attention" | "unavailable";
export type ChannelHealth = { status: HealthStatus; message: string; checkedAt: string };
const result = (status: HealthStatus, message: string): ChannelHealth => ({ status, message, checkedAt: new Date().toISOString() });
const boundedFetch: typeof fetch = (input, init) => fetch(input, { ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000) });

export async function checkGmailHealth(refreshToken: string, address: string | null, fetcher: typeof fetch = boundedFetch) {
  try {
    const token = await refreshGoogleAccessToken(refreshToken, fetcher);
    // Read-only account metadata; never read or send message content.
    const response = await fetcher("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { Authorization: `Bearer ${token}` } });
    if ([401, 403].includes(response.status)) return result("attention", "Gmail access needs attention. Reconnect Gmail and try again.");
    if (!response.ok) return result("unavailable", "Gmail could not be reached. Try again shortly.");
    const profile = await response.json();
    if (!address || typeof profile.emailAddress !== "string" || profile.emailAddress.toLowerCase() !== address.toLowerCase()) return result("attention", "The Gmail account does not match the saved connection. Reconnect Gmail.");
    return result("healthy", "Gmail access verified. No email was sent.");
  } catch (error) {
    if (error instanceof Error && /Google token refresh failed \((400|401)\)/.test(error.message)) return result("attention", "Gmail authorization has expired or been revoked. Reconnect Gmail.");
    return result("unavailable", "Gmail could not be checked. Try again shortly.");
  }
}

export async function checkHostedHealth(provider: "linkedin" | "whatsapp", owner: { organizationId: string; userId: string }, fetcher: typeof fetch = boundedFetch) {
  const name = provider === "linkedin" ? "LinkedIn" : "WhatsApp";
  const prefix = provider.toUpperCase();
  const base = process.env[`${prefix}_SERVICE_URL`];
  const secret = process.env[`${prefix}_SERVICE_SECRET`];
  if (!base || !secret) return result("unavailable", `${name} connection service is not configured.`);
  try {
    const connection = new URL("/connection", base);
    connection.search = new URLSearchParams(owner).toString();
    const headers = { Authorization: `Bearer ${secret}` };
    const [health, session] = await Promise.all([
      fetcher(new URL("/health", base), { headers }),
      fetcher(connection, { headers }),
    ]);
    if (!health.ok || !session.ok) return result("unavailable", `${name} connection service could not be checked. Try again shortly.`);
    const healthData = await health.json();
    if (healthData.ok !== true) return result("unavailable", `${name} connection service is unavailable.`);
    const data = await session.json();
    if (data.status === "connected") return result("healthy", `${name} service is reachable and your session is connected. No message was sent.`);
    if (["browser_crashed", "browser_unresponsive", "browser_closed"].includes(data.status)) return result("attention", `${name} browser ${data.status === "browser_crashed" ? "has crashed" : data.status === "browser_closed" ? "is closed" : "is not responding"}. Open the browser to recover your session. No message was sent.`);
    if (data.status === "paused") return result("attention", `${name} session is saved but paused. Open the browser to resume it.`);
    if (["login_required", "reconnect_required"].includes(data.status)) return result("attention", `${name} needs you to reconnect or complete verification.`);
    if (["connecting", "reconnecting", "qr"].includes(data.status)) return result("attention", `${name} is still connecting. Complete setup and test again.`);
    return result("attention", `${name} is not connected. Connect your account to continue.`);
  } catch { return result("unavailable", `${name} connection service could not be reached. Try again shortly.`); }
}
