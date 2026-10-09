import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPublicApp } from "./app-public-smoke.mjs";
const origin = "https://acquire.mlai.au";
const healthy = async url => ["/api/health", "/sign-in"].includes(new URL(url).pathname)
  ? new Response("", { status: 200 }) : new Response(null, { status: 307, headers: { location: `${origin}/sign-in` } });
test("accepts the public app and expected connection redirects", async () => { await checkPublicApp(healthy); });
test("rejects the internal-container OAuth redirect regression", async () => {
  await assert.rejects(checkPublicApp(async url => new URL(url).pathname === "/api/mailbox/google/connect"
    ? new Response(null, { status: 307, headers: { location: "https://0.0.0.0:3000/sign-in" } }) : healthy(url)), /redirect check failed/);
});
test("rejects an unhealthy app", async () => { await assert.rejects(checkPublicApp(async () => new Response(null, { status: 503 })), /Public check failed/); });
