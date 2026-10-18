import { createServer, connect } from 'node:net';
// Fixed local-service relays only; no request can choose another destination.
// They listen only inside the app's shared network namespace.
for (const port of [18083]) {
  createServer(socket => {
    const upstream = connect({ host: 'host.docker.internal', port });
    socket.setTimeout(120000, () => socket.destroy());
    upstream.setTimeout(120000, () => upstream.destroy());
    socket.on('error', () => upstream.destroy());
    upstream.on('error', () => socket.destroy());
    socket.on('close', () => upstream.destroy());
    upstream.on('close', () => socket.destroy());
    socket.pipe(upstream).pipe(socket);
  }).listen(port, '127.0.0.1', () => console.log(`Local research transport ready on loopback:${port}`));
}
