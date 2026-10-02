import { afterEach, expect, it, vi } from "vitest";
import { validateFirmableSession } from "./firmable-session-validation";

const env = { FIRMABLE_CLIENT_COOKIE: "private-cookie", FIRMABLE_SESSION_ID: "sess_test", FIRMABLE_ORGANIZATION_ID: "org_test" };
const jwt = (claims = {}) => `e30.${btoa(JSON.stringify({ sid: "sess_test", o: { id: "org_test" }, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60, ...claims }))}.signature`;
afterEach(() => vi.restoreAllMocks());

it("renews without an old JWT and keeps the cookie scoped to Clerk and personal data out of diagnostics", async () => {
  const token = jwt();
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ jwt: token }))
    .mockResolvedValueOnce(Response.json({ id: "f000000173355", name: "Successful Endeavours Pty Ltd", description: "private-extra" }))
    .mockResolvedValueOnce(Response.json({ success: true, total: 6, records: [{ name: "Private Person", work_emails: ["private@example.com"] }] }));
  const response = await validateFirmableSession(env, fetcher);
  expect(response.status).toBe(200);
  const output = await response.text();
  expect(JSON.parse(output)).toMatchObject({ ok: true, people: { pageCount: 1, total: 6 }, renewal: { cookieReplaced: false } });
  for (const secret of [token, env.FIRMABLE_CLIENT_COOKIE, "Private Person", "private@example.com", "private-extra"]) expect(output).not.toContain(secret);
  const renewal = fetcher.mock.calls[0][1]!;
  expect(new Headers(renewal.headers).get("cookie")).toBe("__client=private-cookie");
  expect(new URLSearchParams(String(renewal.body)).has("token")).toBe(false);
  for (const [, init] of fetcher.mock.calls.slice(1)) {
    expect(new Headers(init!.headers).has("cookie")).toBe(false);
    expect(new Headers(init!.headers).get("authorization")).toBe(`Bearer ${token}`);
    expect(init!.redirect).toBe("manual");
  }
});

it("reports a rate limit without exposing the upstream body or retrying a burst", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ jwt: jwt() }))
    .mockResolvedValueOnce(new Response("sensitive upstream body", { status: 429, headers: { "Retry-After": "30" } }));
  const response = await validateFirmableSession(env, fetcher);
  expect(response.status).toBe(429);
  expect(await response.json()).toEqual({ error: "Firmable validation failed", phase: "company", upstreamStatus: 429, category: "rate_limited", retryAfter: "30" });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("rejects a renewed token for another organization before requesting company data", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ jwt: jwt({ o: { id: "org_other" } }) }));
  expect(await (await validateFirmableSession(env, fetcher)).json()).toMatchObject({ category: "unexpected_token_context" });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("reports rotated client credentials without returning their value", async () => {
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ jwt: jwt() }, { headers: { "Set-Cookie": "__client=rotated-secret; HttpOnly; Secure" } }))
    .mockResolvedValueOnce(Response.json({ id: "f000000173355", name: "Company" }))
    .mockResolvedValueOnce(Response.json({ success: true, total: 0, records: [] }));
  const response = await validateFirmableSession(env, fetcher);
  const output = await response.text();
  expect(JSON.parse(output).renewal.cookieReplaced).toBe(true);
  expect(output).not.toContain("rotated-secret");
});

it("does not call upstream when credentials are missing", async () => {
  const fetcher = vi.fn<typeof fetch>();
  expect((await validateFirmableSession({}, fetcher)).status).toBe(503);
  expect(fetcher).not.toHaveBeenCalled();
});

it("rejects redirects without forwarding credentials to the location", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: "https://other.example" } }));
  expect(await (await validateFirmableSession(env, fetcher)).json()).toMatchObject({ phase: "renewal", category: "unexpected_redirect" });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][1]?.redirect).toBe("manual");
});
