import { expect, it } from "vitest";
import { serializeAppEnvironment } from "./app-environment.mjs";

it("preserves literal secrets and encodes multiline certificates", () => {
  const output = serializeAppEnvironment({ BETTER_AUTH_SECRET: 'literal$secret#with"quotes', DATABASE_SSL_CA: "first\nsecond\n" });
  expect(output).toContain('BETTER_AUTH_SECRET=literal$secret#with"quotes\n');
  const encoded = output.split("\n").find(row => row.startsWith("DATABASE_SSL_CA_BASE64=")).slice("DATABASE_SSL_CA_BASE64=".length);
  expect(Buffer.from(encoded, "base64").toString()).toBe("first\nsecond\n");
});

it("rejects deployment credentials, local test settings and environment injection", () => {
  for (const input of [{ DIGITALOCEAN_TOKEN: "secret" }, { VERCEL_TOKEN: "secret" }, { LOCAL_DEVELOPMENT: "true" }, { CAMPAIGN_TEST_SINK_URL: "http://sink" }, { APP_URL: "https://app\nINJECTED=yes" }])
    expect(() => serializeAppEnvironment(input)).toThrow();
});
