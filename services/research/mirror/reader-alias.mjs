// The app expects loopback Crawl4AI. Reuse the authenticated research reader.
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
export function createReaderAlias({ secret, fetcher = fetch }) {
  if (!secret) throw Error("Mirror research service secret required");
  return createServer(async (request, response) => {
    const reply = (status, body) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    try {
      const health = request.url === "/health" && request.method === "GET";
      if (!health && (request.url !== "/crawl" || request.method !== "POST"))
        return reply(404, { error: "Unsupported reader path" });
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 20000) return reply(413, { error: "Request too large" });
        chunks.push(chunk);
      }
      const headers = new Headers({
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
      });
      for (const [name, value] of Object.entries(request.headers))
        if (
          typeof value === "string" &&
          (name === "x-request-id" ||
            name.startsWith("x-research-") ||
            name.startsWith("x-acquire-native-"))
        )
          headers.set(name, value);
      const upstream = await fetcher(
        "http://host.docker.internal:18798" +
          (health ? "/health/ready" : "/company-page"),
        {
          method: health ? "GET" : "POST",
          headers,
          ...(!health ? { body: Buffer.concat(chunks) } : {}),
          redirect: "manual",
          signal: AbortSignal.timeout(40000),
        },
      );
      if (upstream.status >= 300 && upstream.status < 400) {
        await upstream.body?.cancel();
        return reply(502, { error: "Reader redirect refused" });
      }
      const body = Buffer.from(await upstream.arrayBuffer());
      if (body.length > 2000000)
        return reply(502, { error: "Reader response too large" });
      response.writeHead(upstream.status, {
        "content-type":
          upstream.headers.get("content-type") || "application/json",
        ...(upstream.headers.has("retry-after")
          ? { "retry-after": upstream.headers.get("retry-after") }
          : {}),
      });
      response.end(body);
    } catch {
      if (!response.headersSent)
        reply(502, { error: "Mirror reader unavailable" });
      else response.end();
    }
  });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const server = createReaderAlias({
    secret: process.env.RESEARCH_SERVICE_SECRET,
  });
  server.listen(18083, "127.0.0.1", () =>
    console.info(
      "Mirror loopback reader connected through the research bridge",
    ),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => server.close());
}
