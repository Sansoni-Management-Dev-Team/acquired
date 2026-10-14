import { createServer } from 'node:http';
import { once } from 'node:events';
import { it, expect } from 'vitest';
import { UnipileV1HistoryHttp } from './v1-history-http';
import { UnipileV1Transport } from './v1-http';
import { createUnipileV1HistorySource } from './v1-history';
import { createUnipileV1ReplyEnricher } from './v1-reply-enrichment';
import type { ConnectionBinding } from '../../contracts/src';
it('real loopback GET pagination composes existing exact message/participant/alias enricher without provider writes', async () => {
    const binding: ConnectionBinding = { applicationId: 'fixture', tenantId: 't', ownerId: 'o', connectionId: 'c', accountId: 'physical', generation: 1, channel: 'linkedin', platform: 'linkedin', backend: 'unipile' }, since = '2026-10-14T08:00:00.000Z', through = '2026-10-14T09:00:00.000Z';
    const record = { binding, providerAccountId: 'provider', sourceId: 'classic', ownerIdentity: { namespace: 'unipile.v1.linkedin.im.id', value: 'self' } };
    const account = { object: 'Account', id: 'provider', type: 'LINKEDIN', connection_params: { im: { id: 'self' } }, sources: [{ id: 'classic', status: 'OK' }] }, message = { object: 'Message', id: 'm', account_id: 'provider', chat_id: 'chat', timestamp: since, sender_id: 'peer', sender_attendee_id: 'att-peer', is_sender: 0, is_event: 0, hidden: 0, deleted: 0, message_type: 'MESSAGE' }, requests: {
        method: string;
        url: string;
        cache: string | undefined;
    }[] = [];
    const server = createServer((req, res) => {
        const url = new URL(req.url!, 'http://fixture');
        requests.push({ method: req.method!, url: req.url!, cache: req.headers['cache-control'] });
        let body: unknown;
        if (url.pathname === '/api/v1/accounts/provider')
            body = account;
        else if (url.pathname === '/api/v1/messages')
            body = url.searchParams.has('cursor') ? { object: 'MessageList', items: [message], cursor: null } : { object: 'MessageList', items: [], cursor: 'next' };
        else if (url.pathname === '/api/v1/chats/chat')
            body = { object: 'Chat', id: 'chat', account_id: 'provider', account_type: 'LINKEDIN', type: 0 };
        else if (url.pathname === '/api/v1/chats/chat/attendees')
            body = { object: 'ChatAttendeeList', items: [{ object: 'ChatAttendee', id: 'att-self', account_id: 'provider', provider_id: 'self', is_self: 1 }, { object: 'ChatAttendee', id: 'att-peer', account_id: 'provider', provider_id: 'peer', is_self: 0 }], cursor: null };
        else if (url.pathname === '/api/v1/messages/m')
            body = message;
        else {
            res.writeHead(404);
            res.end();
            return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string')
        throw Error();
    try {
        const config = { apiVersion: 'v1' as const, baseUrl: `http://127.0.0.1:${address.port}/api/v1`, apiKey: 'synthetic-local-only', allowLoopbackHttp: true }, transport = new UnipileV1Transport(config), enricher = createUnipileV1ReplyEnricher({ binding, providerAccountId: 'provider', sourceId: 'classic', eventsFrom: since, channel: 'linkedin', ownerProviderId: 'self', product: 'classic', transport, verifyOwner: async () => true, resolveAlias: async () => ({ binding, providerAccountId: 'provider', sourceId: 'classic', providerId: 'peer', product: 'classic', identity: { kind: 'linkedin_profile', value: 'https://www.linkedin.com/in/peer/' } }), now: () => Date.parse(through) });
        const source = createUnipileV1HistorySource({ record, transport: new UnipileV1HistoryHttp(config), eventAccountInfo: { ownerProviderId: 'self', product: 'classic' }, resolveCurrent: async () => record, initialSync: async () => ({ kind: 'provider_sync_success' as const, record, evidenceId: 'authenticated-fixture-sync', completedAt: since }), normalize: (raw, b) => enricher.normalize(raw, b), now: () => Date.parse(through) });
        const result = await source.read({ binding, scope: 'all-replies', since, cursor: null, refresh: true });
        expect(result.coverage.complete).toBe(true);
        expect(result.events).toHaveLength(1);
        expect(result.events[0]).toMatchObject({ type: 'message', direction: 'inbound', sender: { kind: 'linkedin_profile', value: 'https://www.linkedin.com/in/peer/' } });
        expect(requests.every(r => r.method === 'GET' && r.cache === 'no-store')).toBe(true);
        expect(requests.filter(r => new URL(r.url, 'http://fixture').pathname === '/api/v1/messages')).toHaveLength(2);
    }
    finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
});
