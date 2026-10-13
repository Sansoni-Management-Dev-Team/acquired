import { describe, expect, it } from 'vitest';
import { validateStandaloneContainer } from '../../scripts/communications-standalone-fixture-guards.mjs';
// Pure identity guard review; no Docker, credentials, database or startup operation.
describe('independent standalone fixture image identity review', () => {
  it('rejects a different actual image even when the configured reference and fixture metadata match', () => {
    const ports = { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '5446' }] };
    const metadata = { Name: '/acquire-communications-standalone-postgres-1', Config: { Image: 'postgres@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193', Labels: { 'acquire.fixture': 'communications-standalone', 'com.docker.compose.project': 'acquire-communications-standalone' } }, State: { Running: true, Health: { Status: 'healthy' } }, HostConfig: { NetworkMode: 'acquire-communications-standalone_default', PortBindings: ports }, NetworkSettings: { Ports: ports }, Image: `sha256:${'f'.repeat(64)}` };
    expect(() => validateStandaloneContainer(metadata)).toThrow();
  });
});
