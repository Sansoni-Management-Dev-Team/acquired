import { readFileSync, writeFileSync, chmodSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function serializeAppEnvironment(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Environment must be a JSON object");
  const values = { ...input };
  if (values.DATABASE_SSL_CA) {
    if (values.DATABASE_SSL_CA_BASE64) throw new Error("Supply only one database certificate representation");
    values.DATABASE_SSL_CA_BASE64 = Buffer.from(values.DATABASE_SSL_CA).toString("base64");
    delete values.DATABASE_SSL_CA;
  }
  const forbidden = /^(?:VERCEL_|DIGITALOCEAN_|LOCAL_DEVELOPMENT$|CAMPAIGN_E2E_LOCAL$|CAMPAIGN_TEST_|APP_STANDALONE$)/;
  return Object.entries(values).map(([key, value]) => {
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || forbidden.test(key)) throw new Error(`Invalid hosted variable name: ${key}`);
    if (typeof value !== "string" || /[\r\n\0]/.test(value)) throw new Error(`Invalid single-line value for ${key}`);
    return `${key}=${value}`;
  }).join("\n") + "\n";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, output, ...extra] = process.argv.slice(2);
  if (!input || !output || extra.length) throw new Error("Usage: node scripts/app-environment.mjs input.json output.env");
  const contents = serializeAppEnvironment(JSON.parse(readFileSync(input, "utf8")));
  writeFileSync(output, contents, { mode: 0o600 });
  chmodSync(output, 0o600);
  console.log("Wrote restricted hosted environment; no values displayed");
}
