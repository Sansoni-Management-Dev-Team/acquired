import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { decryptToken, encryptToken } from "./token-crypto";

describe("refresh token encryption", () => {
  beforeEach(() => { process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64"); });
  it("round trips without exposing plaintext", () => {
    const encrypted = encryptToken("refresh-secret");
    expect(encrypted).not.toContain("refresh-secret");
    expect(decryptToken(encrypted)).toBe("refresh-secret");
  });
  it("rejects tampering", () => {
    const encrypted = encryptToken("refresh-secret");
    expect(() => decryptToken(`${encrypted.slice(0, -1)}x`)).toThrow();
  });
});
