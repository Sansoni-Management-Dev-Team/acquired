import { beforeEach, describe, expect, it } from "vitest";
import { createGoogleAuthorization, fetchGoogleUserInfo, refreshGoogleAccessToken, verifyGoogleState } from "./google-oauth";

describe("Google mailbox OAuth", () => {
  beforeEach(() => { process.env.BETTER_AUTH_SECRET = "test-secret-that-is-long-enough"; process.env.APP_URL = "http://localhost:3000"; });
  it("uses the dedicated callback and Gmail compose scope", () => {
    const auth = createGoogleAuthorization({ userId: "u1", organizationId: "o1", loginHint: "me@example.com", now: 1000 });
    const url = new URL(auth.url);
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/mailbox/google/callback");
    expect(url.searchParams.get("scope")).toContain("gmail.compose");
    expect(url.searchParams.get("scope")).not.toContain("gmail.send");
    expect(verifyGoogleState(auth.state, 1001).userId).toBe("u1");
  });
  it("rejects tampered and expired state", () => {
    const auth = createGoogleAuthorization({ userId: "u1", organizationId: "o1", now: 1000 });
    expect(() => verifyGoogleState(`${auth.state}x`, 1001)).toThrow("Invalid");
    expect(() => verifyGoogleState(auth.state, 1_000_000)).toThrow("expired");
  });
  it("reads the verified mailbox address from Google user info", async () => {
    const fetcher = async () => new Response(JSON.stringify({ email: "owner@example.com", email_verified: true }));
    await expect(fetchGoogleUserInfo("access-token", fetcher as typeof fetch)).resolves.toMatchObject({ email: "owner@example.com" });
  });
  it("exchanges a stored refresh token for a short-lived access token", async () => {
    const fetcher = async (_url: string | URL | Request, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("refresh_token")).toBe("refresh-secret");
      expect(body.get("grant_type")).toBe("refresh_token");
      return new Response(JSON.stringify({ access_token: "short-lived-access", expires_in: 3600 }));
    };
    await expect(refreshGoogleAccessToken("refresh-secret", fetcher as typeof fetch)).resolves.toBe("short-lived-access");
  });
});
