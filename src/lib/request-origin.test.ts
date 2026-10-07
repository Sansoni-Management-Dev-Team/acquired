import { afterEach, expect, it, vi } from "vitest";
import { appRedirectUrl, hasTrustedRequestOrigin } from "./request-origin";

afterEach(() => vi.unstubAllEnvs());

it("keeps OAuth redirects on the public origin with query parameters preserved", () => {
  vi.stubEnv("APP_URL", "https://acquire.mlai.au");
  const request = new Request("http://0.0.0.0:3000/api/mailbox/google/callback");
  expect(appRedirectUrl("/settings?gmail=connected", request).href).toBe("https://acquire.mlai.au/settings?gmail=connected");
  for (const path of ["//evil.example", "https://evil.example", "/\\evil.example"]) expect(() => appRedirectUrl(path, request)).toThrow();
});

it("accepts the configured HTTPS origin behind the container proxy", () => {
  vi.stubEnv("APP_URL", "https://acquire.mlai.au");
  expect(hasTrustedRequestOrigin(new Request("http://0.0.0.0:3000/api/channels/health", { headers: { origin: "https://acquire.mlai.au" } }))).toBe(true);
});

it("rejects foreign, missing, null and internal origins even with spoofed forwarded headers", () => {
  vi.stubEnv("APP_URL", "https://acquire.mlai.au");
  for (const origin of ["https://evil.example", "null", "http://0.0.0.0:3000", ""]) {
    expect(hasTrustedRequestOrigin(new Request("https://evil.example/api/channels/health", { headers: { origin, host: "evil.example", "x-forwarded-host": "evil.example" } }))).toBe(false);
  }
});

it("allows development URL fallback but fails closed without production configuration", () => {
  vi.stubEnv("APP_URL", "");
  const request = new Request("http://localhost:3014/api/channels/health", { headers: { origin: "http://localhost:3014" } });
  vi.stubEnv("NODE_ENV", "development");
  expect(hasTrustedRequestOrigin(request)).toBe(true);
  vi.stubEnv("NODE_ENV", "production");
  expect(hasTrustedRequestOrigin(request)).toBe(false);
});
