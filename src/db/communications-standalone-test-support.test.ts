import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCommunicationsStandaloneFixture } from './communications-standalone-test-support';
import { parseStandaloneEnv } from '../../scripts/communications-standalone-fixture-guards.mjs';

afterEach(() => vi.unstubAllEnvs());
describe('standalone fixture prerequisite isolation', () => {
  it('sanitizes malformed private fixture credential errors', () => {
    const syntheticSecret = 'private_fixture_short';
    let caught: unknown;
    try { parseStandaloneEnv(`POSTGRES_USER=communications_fixture\nPOSTGRES_DB=communications_fixture\nPOSTGRES_PASSWORD=${syntheticSecret}\n`); }
    catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(Error);
    expect(String(caught)).toBe('Error: Invalid fixture credential format');
    expect(String(caught)).not.toContain(syntheticSecret);
  });
  it('constructs and closes without reading private configuration or starting a database', async () => {
    vi.stubEnv('COMMUNICATIONS_STANDALONE_AUDIT', undefined);
    const fixture = createCommunicationsStandaloneFixture();
    await expect(fixture.close()).resolves.toBeUndefined();
  });
  it('rejects all database work before explicit preflight', async () => {
    const fixture = createCommunicationsStandaloneFixture();
    expect(() => fixture.pool.query('SELECT 1')).toThrow('Preflight must establish');
    expect(() => fixture.pool.connect()).toThrow('Preflight must establish');
    await expect(fixture.driver.connect()).rejects.toThrow('Preflight must establish');
    await fixture.close();
  });
  it('requires explicit opt-in before reading credentials or inspecting Docker', async () => {
    vi.stubEnv('COMMUNICATIONS_STANDALONE_AUDIT', undefined);
    const fixture = createCommunicationsStandaloneFixture();
    await expect(fixture.preflight()).rejects.toThrow('Requires explicit standalone fixture opt-in');
    await fixture.close();
  });
  it.each(['public.member', 'communications.events; CREATE TABLE forbidden()', 'communications.unknown-name'])('rejects an unsafe prerequisite %s without database activity', async name => {
    vi.stubEnv('COMMUNICATIONS_STANDALONE_AUDIT', undefined);
    const fixture = createCommunicationsStandaloneFixture();
    await expect(fixture.preflight([name])).rejects.toThrow('Only explicitly named');
    await fixture.close();
  });
});
