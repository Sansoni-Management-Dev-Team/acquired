import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { projectV1CanonicalOwner, UnipileV1OwnerReader } from './v1-owner';
const account = (type = 'GOOGLE_OAUTH', product: Record<string, unknown> = { id: 'opaque-owner', username: 'not-a-mailbox' }) => ({ object: 'Account', id: 'provider/id', type, connection_params: { [type === 'WHATSAPP' || type === 'LINKEDIN' ? 'im' : 'mail']: product }, sources: [{ id: 'opaque-source', status: 'OK' }] });
const profile = { object: 'AccountOwnerProfile', provider: 'GMAIL', email: 'Primary@Example.com', aliases: [{ email: 'alias@example.com', verification_status: 'accepted' }, { email: 'not-verified@example.com', verification_status: 'pending' }] };
describe('canonical v1 account owner reads', () => {
    it('uses own-profile primary email and verified aliases, not login/opaque account IDs', () => { const result = projectV1CanonicalOwner(account(), profile, { platform: 'gmail', providerAccountId: 'provider/id' }); expect(result.kind).toBe('verified'); if (result.kind === 'verified') {
        expect(result.owner.physicalOwner).toEqual({ namespace: 'mailbox_address', value: 'primary@example.com' });
        expect(result.owner.aliases).toEqual([{ kind: 'email', value: 'primary@example.com' }, { kind: 'email', value: 'alias@example.com' }]);
        expect(result.owner.providerOwner.value).toBe('opaque-owner');
    } });
    it('rejects wrong OAuth provider identity', () => expect(projectV1CanonicalOwner(account('OUTLOOK'), { object: 'AccountOwnerProfile', provider: 'OUTLOOK', id: 'other', email: 'owner@example.com' }, { platform: 'outlook', providerAccountId: 'provider/id' })).toEqual({ kind: 'review', code: 'account_changed' }));
    it('IMAP login addresses cannot establish mailbox ownership', () => expect(projectV1CanonicalOwner(account('MAIL', { imap_user: 'owner@example.com', smtp_user: 'owner@example.com' }), null, { platform: 'imap', providerAccountId: 'provider/id' })).toEqual({ kind: 'review', code: 'identity_pending' }));
    it('uses exact E164 from authenticated WhatsApp account', () => { const result = projectV1CanonicalOwner(account('WHATSAPP', { phone_number: '+15550000123' }), null, { platform: 'whatsapp', providerAccountId: 'provider/id' }); expect(result.kind === 'verified' && result.owner.physicalOwner).toEqual({ namespace: 'e164', value: '+15550000123' }); });
    it('requires LinkedIn me provider ID to match original account owner', () => expect(projectV1CanonicalOwner(account('LINKEDIN'), { object: 'AccountOwnerProfile', provider: 'LINKEDIN', provider_id: 'other', public_identifier: 'owner' }, { platform: 'linkedin', providerAccountId: 'provider/id' })).toEqual({ kind: 'review', code: 'account_changed' }));
    it('records actual LinkedIn member and public profile in distinct namespaces', () => { const r = projectV1CanonicalOwner(account('LINKEDIN'), { object: 'AccountOwnerProfile', provider: 'LINKEDIN', provider_id: 'opaque-owner', public_identifier: 'owner' }, { platform: 'linkedin', providerAccountId: 'provider/id' }); expect(r.kind === 'verified' && r.owner.canonicalIdentity).toEqual({ kind: 'linkedin_profile', value: 'https://www.linkedin.com/in/owner' }); });
    it('ambiguous source products require explicit source selection', () => { const raw = account(); raw.sources.push({ id: 'calendar-source', status: 'OK' }); expect(projectV1CanonicalOwner(raw, profile, { platform: 'gmail', providerAccountId: 'provider/id' })).toEqual({ kind: 'review', code: 'identity_pending' }); expect(projectV1CanonicalOwner(raw, profile, { platform: 'gmail', providerAccountId: 'provider/id', sourceId: 'opaque-source' }).kind).toBe('verified'); });
    it('real native HTTP scopes the me read and preserves opaque account ID encoding', async () => { const paths: string[] = []; const server = createServer((req, res) => { paths.push(req.url!); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(req.url!.includes('/accounts/') ? account() : profile)); }); await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); try {
        const reader = new UnipileV1OwnerReader({ apiVersion: 'v1', baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`, apiKey: 'synthetic-only', allowLoopbackHttp: true });
        expect((await reader.verify({ platform: 'gmail', providerAccountId: 'provider/id' })).kind).toBe('verified');
        expect(paths).toEqual(['/api/v1/accounts/provider%2Fid', '/api/v1/users/me?account_id=provider%2Fid']);
    }
    finally {
        server.closeAllConnections();
        await new Promise<void>(r => server.close(() => r()));
    } });
});
