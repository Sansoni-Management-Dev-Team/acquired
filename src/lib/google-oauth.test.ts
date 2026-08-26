import { beforeEach, describe, expect, it } from "vitest";
import { createGoogleAuthorization, verifyGoogleState } from "./google-oauth";

describe("Google mailbox OAuth", () => {
  beforeEach(() => { process.env.BETTER_AUTH_SECRET = "test-secret-that-is-long-enough"; process.env.APP_URL = "http://localhost:3000"; });
  it("uses the dedicated callback and narrow Gmail scope", () => {
    const auth = createGoogleAuthorization({ userId: "u1", organizationId: "o1", loginHint: "me@example.com", now: 1000 });
    const url = new URL(auth.url);
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/mailbox/google/callback");
    expect(url.searchParams.get("scope")).toContain("gmail.send");
    expect(url.searchParams.get("scope")).not.toContain("gmail.compose");
    expect(verifyGoogleState(auth.state, 1001).userId).toBe("u1");
  });
  it("rejects tampered and expired state", () => {
    const auth = createGoogleAuthorization({ userId: "u1", organizationId: "o1", now: 1000 });
    expect(() => verifyGoogleState(`${auth.state}x`, 1001)).toThrow("Invalid");
    expect(() => verifyGoogleState(auth.state, 1_000_000)).toThrow("expired");
  });
});
