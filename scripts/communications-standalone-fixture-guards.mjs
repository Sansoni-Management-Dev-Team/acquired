// Pure fixture identity/environment guards. No I/O, startup, SQL or provider operation.
import assert from 'node:assert/strict';
const containerName = 'acquire-communications-standalone-postgres-1';
const imageReference = 'postgres@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193';
export function validateStandaloneContainer(m) {
  assert.equal(m.Name, `/${containerName}`);
  assert.equal(m.Config?.Labels?.['acquire.fixture'], 'communications-standalone');
  assert.equal(m.Config?.Labels?.['com.docker.compose.project'], 'acquire-communications-standalone');
  assert.equal(m.Config?.Image, imageReference);
  assert.equal(m.State?.Running, true); assert.equal(m.State?.Health?.Status, 'healthy');
  assert.equal(m.HostConfig?.NetworkMode, 'acquire-communications-standalone_default');
  const ports = { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '5446' }] };
  assert.deepEqual(m.HostConfig.PortBindings, ports); assert.deepEqual(m.NetworkSettings?.Ports, ports);
  assert.equal(m.Image, imageReference.slice('postgres@'.length));
  return m.Image;
}
export function parseStandaloneEnv(text) {
  try {
  const v = Object.create(null);
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const match = /^(POSTGRES_USER|POSTGRES_DB|POSTGRES_PASSWORD)=([A-Za-z0-9_-]+)$/.exec(line);
    assert.ok(match && !Object.hasOwn(v, match[1]), 'Invalid fixture credential format');
    v[match[1]] = match[2];
  }
  assert.equal(v.POSTGRES_USER, 'communications_fixture'); assert.equal(v.POSTGRES_DB, 'communications_fixture');
  assert.match(v.POSTGRES_PASSWORD ?? '', /^[A-Za-z0-9_-]{32,256}$/);
  return v;
  } catch { throw Error('Invalid fixture credential format'); }
}
