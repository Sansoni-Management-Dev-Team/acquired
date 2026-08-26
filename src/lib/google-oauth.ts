import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const GOOGLE_MAIL_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/gmail.send"];
type OAuthState = { userId: string; organizationId: string; nonce: string; verifier: string; expiresAt: number };

function secret() {
  const value = process.env.BETTER_AUTH_SECRET;
  if (!value) throw new Error("BETTER_AUTH_SECRET is not configured");
  return value;
}

function googleClientId() { return process.env.GOOGLE_GMAIL_CLIENT_ID || ""; }
function redirectUri() { return process.env.GOOGLE_GMAIL_REDIRECT_URI || `${process.env.APP_URL || "http://localhost:3000"}/api/mailbox/google/callback`; }

export function createGoogleAuthorization(input: { userId: string; organizationId: string; loginHint?: string; now?: number }) {
  const verifier = randomBytes(32).toString("base64url");
  const payload: OAuthState = { userId: input.userId, organizationId: input.organizationId, nonce: randomBytes(16).toString("base64url"), verifier, expiresAt: (input.now || Date.now()) + 10 * 60_000 };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret()).update(encoded).digest("base64url");
  const state = `${encoded}.${signature}`;
  const query = new URLSearchParams({ client_id: googleClientId(), redirect_uri: redirectUri(), response_type: "code", scope: GOOGLE_MAIL_SCOPES.join(" "), access_type: "offline", prompt: "consent", state, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" });
  if (input.loginHint) query.set("login_hint", input.loginHint);
  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${query}`, state };
}

export function verifyGoogleState(state: string, now = Date.now()): OAuthState {
  const [encoded, supplied] = state.split(".");
  if (!encoded || !supplied) throw new Error("Invalid OAuth state");
  const expected = createHmac("sha256", secret()).update(encoded).digest();
  const actual = Buffer.from(supplied, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("Invalid OAuth state");
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as OAuthState;
  if (payload.expiresAt < now) throw new Error("OAuth state expired");
  return payload;
}

export async function exchangeGoogleCode(code: string, verifier: string, fetcher: typeof fetch = fetch) {
  const response = await fetcher("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: googleClientId(), client_secret: process.env.GOOGLE_GMAIL_CLIENT_SECRET || "", redirect_uri: redirectUri(), grant_type: "authorization_code", code_verifier: verifier }) });
  if (!response.ok) throw new Error(`Google token exchange failed (${response.status})`);
  return response.json() as Promise<{ access_token: string; refresh_token?: string; expires_in: number; scope: string; id_token?: string }>;
}

const googleUserInfoSchema = z.object({ email: z.string().email(), email_verified: z.boolean().optional() });

export async function fetchGoogleUserInfo(accessToken: string, fetcher: typeof fetch = fetch) {
  const response = await fetcher("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`Google user info failed (${response.status})`);
  const profile = googleUserInfoSchema.parse(await response.json());
  if (profile.email_verified === false) throw new Error("Google account email is not verified");
  return profile;
}
