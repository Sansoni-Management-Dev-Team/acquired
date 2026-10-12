import { describe, expect, it } from 'vitest';
import { verifyUnipileV1Webhook } from './v1-webhook';
const secret = 'synthetic-v1-webhook-secret';
const verify = (rawHeaders: string[], overrides = {}) => verifyUnipileV1Webhook({ rawHeaders, headerName: 'Unipile-Auth', secret, ...overrides });
describe('v1 configured webhook authentication', () => {
    it('accepts exactly one case-insensitive configured header without exposing secret', () => {
        expect(verify(['content-type', 'application/json', 'unipile-auth', secret])).toEqual({ verified: true });
        expect(JSON.stringify(verify(['Unipile-Auth', secret]))).not.toContain(secret);
    });
    it.each([
        [], ['Unipile-Auth', 'wrong'], ['Unipile-Auth', secret + ' '], ['Unipile-Auth', secret, 'unipile-auth', secret], ['Unipile-Auth', secret + ', ' + secret], ['Unipile-Auth'], ['Unipile-Auth', secret + '\r\n'],
    ].map(headers => ({ headers })))('rejects missing, changed, duplicate, merged or malformed raw headers $headers', ({ headers }) => expect(verify(headers)).toEqual({ verified: false }));
    it.each([{ secret: '' }, { secret: 'bad\nsecret' }, { headerName: 'invalid header' }, { headerName: '' }])('fails closed on invalid config', configuration => expect(verify(['Unipile-Auth', secret], configuration)).toEqual({ verified: false }));
    it('does not claim freshness or replay protection for a static header', () => {
        expect(verify(['Unipile-Auth', secret])).toEqual({ verified: true });
        expect(verify(['Unipile-Auth', secret])).toEqual({ verified: true });
    });
    it('does not accept the v2 signature instead of the configured header', () => expect(verify(['unipile-signature', 't=123,v0=abc'])).toEqual({ verified: false }));
});
