import { describe, it, expect } from 'vitest';
import { createConfiguredUnipileV1Runtime } from './v1-runtime';
import { readConfiguredUnipileV1Environment } from './v1-runtime-env';
const key = (n: number) => Buffer.alloc(32, n).toString('base64');
const env = { UNIPILE_API_URL: 'https://synthetic.unipile.example:20255', UNIPILE_API_KEY: 'synthetic-private-api-key', COMMUNICATIONS_APPLICATION_ID: 'app', COMMUNICATIONS_INTEGRATION_ID: 'integration', COMMUNICATIONS_PROVIDER_CONFIGURATION_REFERENCE: 'config-v1', COMMUNICATIONS_ACTIVE_KEY_VERSION: 'k1', COMMUNICATIONS_KEYRING_JSON: JSON.stringify([{ version: 'k1', encryptionKey: key(1), digestKey: key(2) }]), COMMUNICATIONS_IDENTITY_KEY: key(3), COMMUNICATIONS_IDENTITY_KEY_VERSION: 'identity-v1', COMMUNICATIONS_SETUP_CALLBACK_KEY: key(4), COMMUNICATIONS_SCOPED_AUTH_KEY: key(5), COMMUNICATIONS_WEBHOOK_SECRET: 'synthetic-private-webhook-secret', COMMUNICATIONS_REDIRECT_ORIGIN: 'https://app.example.test', COMMUNICATIONS_SETUP_NOTIFY_URL: 'https://service.example.test/v1/setup/notify' };
const pool = { connect: async () => { throw Error('No I/O permitted'); } };
describe('explicit server environment composition', () => {
    it('decodes separate retained keys into concrete configuration without I/O or process env fallback', () => { const f = readConfiguredUnipileV1Environment(env, pool); expect(f.options.provider.apiVersion).toBe('v1'); expect(f.options.vault.keys[0].encryptionKey).toEqual(Buffer.alloc(32, 1)); expect(f.scopedAuthKey).toEqual(Buffer.alloc(32, 5)); expect(f.options.pool).toBe(pool); });
    it('missing private values fail sanitized without exposing supplied keys', () => { expect(() => readConfiguredUnipileV1Environment({ ...env, COMMUNICATIONS_KEYRING_JSON: 'synthetic-private-json-corrupt' }, pool)).toThrow('Invalid communications environment'); });
    it('rejects key-domain reuse', () => { expect(() => readConfiguredUnipileV1Environment({ ...env, COMMUNICATIONS_SCOPED_AUTH_KEY: key(4) }, pool)).toThrow(); });
    it('normalizes a supplied v1 DSN into directly constructible native HTTP configuration', () => { const f = readConfiguredUnipileV1Environment(env, pool); expect(() => createConfiguredUnipileV1Runtime(f.options)).not.toThrow(); expect(f.options.provider.baseUrl).toBe('https://synthetic.unipile.example:20255/api/v1'); });
});
