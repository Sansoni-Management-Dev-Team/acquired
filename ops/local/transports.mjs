import { createServer, connect } from "node:net";

// Fixed destinations preserve the research worker's existing loopback policy.
for (const [port, host, upstreamPort] of [[5434, "postgres", 5432], [18083, "crawl4ai", 8080], [7000, "openserp", 7000]]) {
  const server = createServer(socket => {
    const upstream = connect({ host, port: upstreamPort });
    socket.setTimeout(120_000, () => socket.destroy());
    upstream.setTimeout(120_000, () => upstream.destroy());
    socket.on("error", () => upstream.destroy());
    upstream.on("error", () => socket.destroy());
    socket.on("close", () => upstream.destroy());
    upstream.on("close", () => socket.destroy());
    socket.pipe(upstream).pipe(socket);
  });
  server.on("error", error => { console.error(`Local transport :${port} failed: ${error.code}`); process.exit(1); });
  server.listen(port, "127.0.0.1", () => console.info(`Local transport ready :${port}`));
}
