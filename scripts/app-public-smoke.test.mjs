import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPublicApp } from "./app-public-smoke.mjs";
const origin = "https://acquire.mlai.au";
const healthy = async url => {
  const path = new URL(url).pathname;
  if (path === "/health") return Response.json({ contractVersion: "1" });
  if (["/api/health", "/sign-in"].includes(path)) return new Response("", { status: 200 });
  if (path === "/api/mailbox/google/callback") return Response.json({ error: "Sign in to manage connections" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  return new Response(null, { status: 307, headers: { location: `${origin}/sign-in` } });
};
test("accepts public app, protected retired callback and expected sign-in redirects", async () => { await checkPublicApp(healthy); });
test("rejects the internal-container OAuth redirect regression", async () => {
  await assert.rejects(checkPublicApp(async url => new URL(url).pathname === "/api/mailbox/google/connect"
    ? new Response(null, { status: 307, headers: { location: "https://0.0.0.0:3000/sign-in" } }) : healthy(url)), /redirect check failed/);
});
test("rejects an unhealthy app", async () => { await assert.rejects(checkPublicApp(async () => new Response(null, { status: 503 })), /Public check failed/); });

test("rejects an anonymous retired callback redirect instead of its protected JSON response", async () => {
 await assert.rejects(checkPublicApp(async url => new URL(url).pathname === "/api/mailbox/google/callback" ? new Response(null, {status:307,headers:{location:origin+"/sign-in"}}) : healthy(url)), /callback check failed/);
});
test("rejects cacheable authentication failures and malformed callback JSON", async () => {
 for (const response of [Response.json({error:"Sign in"},{status:401}),new Response("not json",{status:401,headers:{"Cache-Control":"no-store"}}),Response.json({},{status:401,headers:{"Cache-Control":"no-store"}})])
  await assert.rejects(checkPublicApp(async url => new URL(url).pathname === "/api/mailbox/google/callback" ? response : healthy(url)), /callback check failed/);
});

test("rejects a missing or incompatible public communications health route", async () => {
 for (const response of [new Response("missing", { status: 404 }), Response.json({ contractVersion: "2" })])
  await assert.rejects(checkPublicApp(async url => new URL(url).pathname === "/health" ? response : healthy(url)), /communications health check failed/);
});
