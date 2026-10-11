import { gmailReadHttpFailure } from "@/adapters/gmail-errors";
import { ReplyCheckPending, ReplyCheckReview } from "@/lib/campaign-reply-status";
import { refreshGoogleAccessToken } from "@/lib/google-oauth";

type HealthStatus = "healthy" | "attention" | "unavailable";
export type ChannelHealth = { status: HealthStatus; message: string; checkedAt: string };
const result = (status: HealthStatus, message: string): ChannelHealth => ({ status, message, checkedAt: new Date().toISOString() });
const boundedFetch: typeof fetch = (input, init) => fetch(input, { ...init, cache: "no-store", redirect: "error", signal: init?.signal ?? AbortSignal.timeout(10000) });

export async function checkGmailHealth(refreshToken: string, address: string | null, fetcher: typeof fetch = boundedFetch) {
  try {
    const token = await refreshGoogleAccessToken(refreshToken, fetcher);
    // Read-only account metadata; never read or send message content.
    const response = await fetcher("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { Authorization: `Bearer ${token}` } });
    if ([401,403].includes(response.status)) {
      const failure=await gmailReadHttpFailure(response);
      return failure instanceof ReplyCheckPending ? result("unavailable","Gmail is temporarily rate limited. Try again shortly.") : result("attention","Gmail access needs attention. Reconnect Gmail and try again.");
    }
    if (!response.ok) return result("unavailable", "Gmail could not be reached. Try again shortly.");
    const profile = await response.json();
    if (!address || typeof profile.emailAddress !== "string" || profile.emailAddress.toLowerCase() !== address.toLowerCase()) return result("attention", "The Gmail account does not match the saved connection. Reconnect Gmail.");
    return result("healthy", "Gmail access verified. No email was sent.");
  } catch (error) {
    if (error instanceof ReplyCheckReview && ["reconnect","protocol"].includes(error.code)) return result("attention", "Gmail authorization has expired or been revoked. Reconnect Gmail.");
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
    // Browser startup, account-lock waits and status probes can exceed ten
    // seconds. Keep this below the button's 25-second request deadline.
    const [healthProbe, sessionProbe] = await Promise.allSettled([
      fetcher(new URL("/health", base), { headers, signal: AbortSignal.timeout(10000) }),
      fetcher(connection, { headers, signal: AbortSignal.timeout(provider === "linkedin" ? 20000 : 10000) }),
    ]);
    if (healthProbe.status === "rejected") return result("unavailable", `${name} connection service could not be reached. Try again shortly.`);
    const health = healthProbe.value;
    if (!health.ok) return result("unavailable", `${name} connection service could not be checked. Try again shortly.`);
    const healthData = await health.json();
    if (healthData.ok !== true) return result("unavailable", `${name} connection service is unavailable.`);
    if (sessionProbe.status === "rejected") return result("attention", `${name} service is reachable, but the session check did not finish. Open the browser and test again. No message was sent.`);
    const session = sessionProbe.value;
    if (!session.ok) return result("attention", `${name} service is reachable, but the session could not be checked. Open the browser and test again.`);
    const data = await session.json();
    if (data.status === "connected") return result("healthy", `${name} service is reachable and your session is connected. No message was sent.`);
    if (["browser_crashed", "browser_unresponsive", "browser_closed"].includes(data.status)) return result("attention", `${name} browser ${data.status === "browser_crashed" ? "has crashed" : data.status === "browser_closed" ? "is closed" : "is not responding"}. Open the browser to recover your session. No message was sent.`);
    if (data.status === "paused") return result("attention", `${name} session is saved but paused. Open the browser to resume it.`);
    if (["login_required", "reconnect_required"].includes(data.status)) return result("attention", `${name} needs you to reconnect or complete verification.`);
    if (["connecting", "reconnecting", "qr"].includes(data.status)) return result("attention", `${name} is still connecting. Complete setup and test again.`);
    return result("attention", `${name} is not connected. Connect your account to continue.`);
  } catch { return result("unavailable", `${name} connection service could not be reached. Try again shortly.`); }
}
