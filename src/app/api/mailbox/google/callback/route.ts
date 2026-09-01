import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireDb } from "@/db/client";
import { mailboxConnections } from "@/db/schema";
import { encryptToken } from "@/lib/token-crypto";
import { exchangeGoogleCode, fetchGoogleUserInfo, verifyGoogleState } from "@/lib/google-oauth";
import { connectionCanCompose } from "@/lib/gmail-connection";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateValue = url.searchParams.get("state");
  if (!code || !stateValue) return NextResponse.json({ error: "Missing OAuth response" }, { status: 400 });
  try {
    const state = verifyGoogleState(stateValue);
    const token = await exchangeGoogleCode(code, state.verifier);
    if (!token.refresh_token) throw new Error("Google did not issue a refresh token; reconnect with consent");
    const profile = await fetchGoogleUserInfo(token.access_token);
    const database = requireDb();
    const scopes = token.scope.split(" ");
    if (!connectionCanCompose({ encryptedRefreshToken: token.refresh_token, reconnectRequired: false, scopes })) throw new Error("Google did not grant Gmail draft permission");
    const existing = await database.select({ id: mailboxConnections.id }).from(mailboxConnections).where(and(eq(mailboxConnections.userId, state.userId), eq(mailboxConnections.provider, "gmail"))).limit(1);
    const values = { organizationId: state.organizationId, userId: state.userId, provider: "gmail" as const, address: profile.email, encryptedRefreshToken: encryptToken(token.refresh_token), keyVersion: "v1", scopes, expiresAt: new Date(Date.now() + token.expires_in * 1000), reconnectRequired: false };
    if (existing[0]) await database.update(mailboxConnections).set(values).where(eq(mailboxConnections.id, existing[0].id));
    else await database.insert(mailboxConnections).values(values);
    return NextResponse.redirect(new URL("/settings?gmail=connected", request.url));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gmail connection failed";
    return NextResponse.redirect(new URL(`/settings?gmail=error&reason=${encodeURIComponent(message)}`, request.url));
  }
}
