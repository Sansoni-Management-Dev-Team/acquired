import { test } from "node:test";
import assert from "node:assert/strict";
import { createReaderAlias } from "../mirror/reader-alias.mjs";
async function setup(t, fetcher) {
  const server = createReaderAlias({ secret: "local-app-secret", fetcher });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  return `http://127.0.0.1:${server.address().port}`;
}
test("app page reads authenticate to the fixed bridge and preserve full-page content", async (t) => {
  const calls = [],
    page = {
      url: "https://example.com/",
      html: "<html>Published company information</html>",
      markdown: "Published company information",
      only_main_content: false,
      truncated: false,
    };
  const origin = await setup(t, async (url, options) => {
    calls.push({ url, options });
    return Response.json(page);
  });
  const response = await fetch(origin + "/crawl", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: "private-cookie",
      "x-request-id": "trace-123",
    },
    body: JSON.stringify({ url: page.url, only_main_content: false }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), page);
  assert.equal(calls[0].url, "http://host.docker.internal:18798/company-page");
  assert.equal(
    calls[0].options.headers.get("authorization"),
    "Bearer local-app-secret",
  );
  assert.equal(calls[0].options.headers.get("cookie"), null);
  assert.equal(calls[0].options.headers.get("x-request-id"), "trace-123");
  assert.equal(JSON.parse(calls[0].options.body).only_main_content, false);
});
test("unsupported routes and oversized bodies make no upstream requests", async (t) => {
  let calls = 0;
  const origin = await setup(t, async () => {
    calls++;
    return Response.json({});
  });
  assert.equal(
    (await fetch(origin + "/crawl?url=https://other.example")).status,
    404,
  );
  assert.equal(
    (await fetch(origin + "/arbitrary", { method: "POST", body: "{}" })).status,
    404,
  );
  assert.equal(
    (
      await fetch(origin + "/crawl", {
        method: "POST",
        body: "x".repeat(20001),
      })
    ).status,
    413,
  );
  assert.equal(calls, 0);
});
test("health reflects upstream readiness and redirects are refused", async (t) => {
  const origin = await setup(t, async (url) =>
    url.endsWith("/health/ready")
      ? Response.json({ ready: false }, { status: 503 })
      : new Response(null, {
          status: 302,
          headers: { location: "https://other.example/" },
        }),
  );
  assert.equal((await fetch(origin + "/health")).status, 503);
  assert.equal(
    (await fetch(origin + "/crawl", { method: "POST", body: "{}" })).status,
    502,
  );
});
