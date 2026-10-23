import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ISSUER, REDIRECT_URI, makeFlow, validateCallback, validateMetadata,
  companyArguments, TokenStore, OAuthSession,
} from './adapter.mjs';

const metadata = {
  issuer: ISSUER, authorization_endpoint: `${ISSUER}/oauth/authorize`,
  token_endpoint: `${ISSUER}/oauth/token`, code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none'],
};
const callback = (flow, extra = {}) => {
  const url = new URL(REDIRECT_URI);
  url.search = new URLSearchParams({ state: flow.state, code: 'test-code', ...extra });
  return url;
};

test('uses the pinned issuer and registered callback with fresh S256 PKCE', () => {
  const a = makeFlow(metadata), b = makeFlow(metadata);
  assert.equal(a.url.origin, ISSUER);
  assert.equal(a.url.searchParams.get('redirect_uri'), REDIRECT_URI);
  assert.equal(a.url.searchParams.get('code_challenge_method'), 'S256');
  assert.notEqual(a.state, b.state);
  assert.notEqual(a.verifier, b.verifier);
  assert.equal(validateCallback(callback(a), a), 'test-code');
});

test('rejects metadata issuer, endpoints or PKCE changes', () => {
  assert.throws(() => validateMetadata({ ...metadata, issuer: 'https://agents.firmable.com' }));
  assert.throws(() => validateMetadata({ ...metadata, token_endpoint: 'https://other.example/token' }));
  assert.throws(() => validateMetadata({ ...metadata, code_challenge_methods_supported: ['plain'] }));
  assert.equal(validateMetadata(metadata), metadata);
});

test('rejects bad state, duplicate codes, callback origin and callback issuer', () => {
  const flow = makeFlow(metadata);
  assert.throws(() => validateCallback(callback(flow, { state: 'wrong' }), flow));
  assert.throws(() => validateCallback(callback(flow, { iss: 'https://other.example' }), flow));
  const duplicate = callback(flow); duplicate.searchParams.append('code', 'second');
  assert.throws(() => validateCallback(duplicate, flow));
  const wrongOrigin = callback(flow); wrongOrigin.hostname = '127.0.0.1';
  assert.throws(() => validateCallback(wrongOrigin, flow));
  const required = makeFlow({ ...metadata, authorization_response_iss_parameter_supported: true });
  assert.throws(() => validateCallback(callback(required), required));
  assert.equal(validateCallback(callback(required, { iss: ISSUER }), required), 'test-code');
});

test('limits calls to company tools even if people tools are discovered', () => {
  assert.deepEqual(companyArguments('ai_search', { query: 'bank', category: 'company' }), { query: 'bank', category: 'company' });
  assert.equal(companyArguments('filter_search', { filters: {} }).category, 'company');
  assert.throws(() => companyArguments('ai_search', { category: 'people' }));
  assert.throws(() => companyArguments('get_person', { id: 'person' }));
  assert.throws(() => companyArguments('reveal_person_phone', { id: 'person' }));
  assert.throws(() => companyArguments('get_filter_options', { identifier: 'seniority' }));
});

test('stores credentials privately and refreshes an expired token only once', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'firmable-adapter-test-'));
  try {
    const store = new TokenStore(join(dir, 'private', 'tokens.json'));
    await store.save({ access_token: 'old-test-value', refresh_token: 'refresh-test-value', expires_at: 0,
      issuer: ISSUER, client_id: 'rkI2RHxS55F7qKp8' });
    assert.equal((await stat(store.path)).mode & 0o777, 0o600);
    assert.equal((await stat(join(dir, 'private'))).mode & 0o777, 0o700);
    let calls = 0;
    const fetcher = async (url, init) => {
      calls++;
      assert.equal(url, metadata.token_endpoint);
      assert.equal(init.redirect, 'error');
      assert.equal(init.body.get('grant_type'), 'refresh_token');
      assert.equal(init.body.get('resource'), 'https://agents.firmable.com');
      return Response.json({ access_token: 'new-test-value', token_type: 'Bearer', expires_in: 3600 });
    };
    const session = new OAuthSession(metadata, store, fetcher);
    assert.deepEqual(await Promise.all([session.accessToken(), session.accessToken()]), ['new-test-value', 'new-test-value']);
    assert.equal(calls, 1);
    assert.equal(JSON.parse(await readFile(store.path)).refresh_token, 'refresh-test-value');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
