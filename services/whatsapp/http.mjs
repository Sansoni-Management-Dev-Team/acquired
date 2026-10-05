import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { shardFor } from './routing.mjs';
async function readBody(request) {
  const chunks = []; let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 16384) throw Object.assign(new Error('Message too large'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export function serviceServer(store, sessions, secret) {
  if (!secret || secret.length < 32) throw new Error('WHATSAPP_SERVICE_SECRET must have at least 32 characters');
  return createServer(async (request, response) => {
    const reply = (status, data) => { response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(data)); };
    const provided = Buffer.from(request.headers.authorization || '');
    const expected = Buffer.from(`Bearer ${secret}`);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return reply(401, { error: 'Unauthorized' });
    try {
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname === '/health' && request.method === 'GET') { await store.health(); return reply(200, { ok: true }); }
      if (url.pathname === '/metrics' && request.method === 'GET') return reply(200, sessions.metrics());
      if (!['/connection', '/history', '/group', '/message', '/replies'].includes(url.pathname) || !['GET','POST','DELETE'].includes(request.method)) return reply(404, { error: 'Not found' });
      const actor = { organizationId: url.searchParams.get('organizationId'), userId: url.searchParams.get('userId') };
      if (!actor.organizationId || !actor.userId || actor.organizationId.length > 200 || actor.userId.length > 200) return reply(400, { error: 'Invalid owner' });
      if (store.config) {
        const shard = shardFor(actor, store.config.shardIds);
        if (shard !== store.config.shardId) {
          await store.authorize(actor);
          if (request.headers['x-whatsapp-forwarded']) return reply(421, { error: 'Shard routing configuration mismatch' });
          const target = new URL(url.pathname + url.search, store.config.shards[shard]);
          // Forward once to the assigned shared container. Never retry mutations:
          // a timeout can occur after WhatsApp has already accepted a message.
          const body = ['POST', 'DELETE'].includes(request.method) ? await readBody(request) : undefined;
          const result = await fetch(target, { method: request.method, body,
            headers: { Authorization: `Bearer ${secret}`, 'content-type': 'application/json', 'x-whatsapp-forwarded': '1' },
            redirect: 'error', signal: AbortSignal.timeout(45000) });
          return reply(result.status, await result.json());
        }
      }
      if (url.pathname === '/replies') {
        if (request.method !== 'GET') return reply(405, { error: 'Method not allowed' });
        return reply(200, await sessions.readReplies(actor, url.searchParams.get('cursor')));
      }
      if (url.pathname === '/message') {
        if (request.method !== 'POST') return reply(405, { error: 'Method not allowed' });
        const body = (await readBody(request)).toString('utf8');
        let data; try { data = JSON.parse(body); } catch { return reply(400, { error: 'Invalid message' }); }
        if (!data || typeof data.recipient !== 'string' || !/^\d+@(s\.whatsapp\.net|lid)$/.test(data.recipient)
          || typeof data.text !== 'string' || !data.text.trim() || data.text.length > 4000) return reply(400, { error: 'Invalid message' });
        return reply(200, await sessions.sendText(actor, data.recipient, data.text));
      }
      if (url.pathname === '/group') {
        if (request.method !== 'GET') return reply(405, { error: 'Method not allowed' });
        const groupId = url.searchParams.get('groupId') || '';
        if (!/^\d+(?:-\d+)?@g\.us$/.test(groupId)) return reply(400, { error: 'Invalid group ID' });
        return reply(200, await sessions.readGroup(actor, groupId));
      }
      if (url.pathname === '/history') {
        const limit = Math.max(1, Math.min(5000, Number(url.searchParams.get('limit') || 20)));
        if (!Number.isInteger(limit)) return reply(400, { error: 'Invalid limit' });
        const query = url.searchParams.get('query') || ''; const chatId = url.searchParams.get('chatId') || undefined;
        if (request.method === 'POST') return reply(200, await sessions.requestHistory(actor, chatId));
        if (request.method === 'GET') return reply(200, await sessions.readHistory(actor, query, limit, chatId));
        return reply(405, { error: 'Method not allowed' });
      }
      if (request.method === 'POST') return reply(200, await sessions.connect(actor));
      if (request.method === 'DELETE') { await sessions.disconnect(actor); return reply(200, { status: 'disconnected', qr: null, address: null }); }
      return reply(200, await sessions.status(actor));
    } catch (error) { reply(error.status || 503, { error: error.status === 403 ? 'Membership required' : error.status === 409 ? 'Session already running' : 'WhatsApp service unavailable; check service configuration and schema' }); }
  });
}
