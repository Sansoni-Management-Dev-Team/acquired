import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { uatDatabaseConfig, verifyUatSchema, UAT_TABLES } from '../ops/aws/uat/start.mjs';

const host = 'acquire-n8n-develop.cluster-cjaq4yw64sj8.ap-southeast-2.rds.amazonaws.com';
const env = () => ({ NODE_ENV: 'production', APP_URL: 'https://app.acquire.pajamaprofits.net', NEXT_PUBLIC_APP_URL: 'https://app.acquire.pajamaprofits.net',
  DATABASE_DRIVER: 'postgres', DATABASE_URL: `postgresql://synthetic:unused@${host}:5432/acquire?sslmode=verify-full`,
  DATABASE_SSL_CA_BASE64: Buffer.from('-----BEGIN CERTIFICATE-----\nsynthetic-test-only\n-----END CERTIFICATE-----\n').toString('base64'),
  AWS_UAT_DATABASE_HOST: host, AWS_UAT_DATABASE_NAME: 'acquire', RESEARCH_ENABLED: 'false', COMMUNICATIONS_RUNTIME_ENABLED: 'false', CAMPAIGN_N8N_ENABLED: 'false' });

test('required physical table names exist in the application schema', () => {
  const schema = readFileSync(new URL('../src/db/schema.ts', import.meta.url), 'utf8');
  const physicalTables = new Set([...schema.matchAll(/pgTable\(\s*"([^"]+)"/g)].map(match => `public.${match[1]}`));
  assert.deepEqual(UAT_TABLES.filter(name => !physicalTables.has(name)), []);
});

test('rejects a production/foreign database and enabled automation before creating a connection', () => {
  for (const patch of [{ DATABASE_URL: 'postgresql://private@production.example/acquire' }, { DATABASE_URL: `postgresql://synthetic@${host}/n8n` },
    { AWS_UAT_DATABASE_HOST: 'production.example' }, { APP_URL: 'https://acquire.mlai.au' }, { RESEARCH_ENABLED: 'true' },
    { COMMUNICATIONS_RUNTIME_ENABLED: 'true' }, { CAMPAIGN_N8N_ENABLED: 'true' }, { DATABASE_SSL_CA_BASE64: '' }])
    assert.throws(() => uatDatabaseConfig({ ...env(), ...patch }));
  const config = uatDatabaseConfig(env());
  assert.equal(config.ssl.rejectUnauthorized, true);
  assert.equal(config.connectionString.includes('sslmode'), false);
});

test('inspects prerequisites in a read-only transaction and closes the client', async () => {
  const calls = [];
  const client = { async connect() { calls.push('connect'); }, async end() { calls.push('end'); }, async query(sql, values) {
    calls.push(sql);
    if (values) { assert.deepEqual(values, [UAT_TABLES]); return { rows: [{ missing: [] }] }; }
    return { rows: [] };
  } };
  await verifyUatSchema(client);
  assert.equal(calls[1], 'BEGIN READ ONLY');
  assert.ok(calls.includes('ROLLBACK'));
  assert.equal(calls.at(-1), 'end');
  assert.equal(calls.some(x => /CREATE|ALTER|INSERT|UPDATE|DELETE/i.test(x)), false);
});

test('missing schema fails closed, rolls back, and never bootstraps tables', async () => {
  const calls = [];
  const client = { async connect() {}, async end() { calls.push('end'); }, async query(sql, values) {
    calls.push(sql); return values ? { rows: [{ missing: ['public.user'] }] } : { rows: [] };
  } };
  await assert.rejects(verifyUatSchema(client), /prerequisites/);
  assert.ok(calls.includes('ROLLBACK'));
  assert.equal(calls.at(-1), 'end');
});
