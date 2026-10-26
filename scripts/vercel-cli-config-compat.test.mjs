import {afterEach, expect, it} from 'vitest';
import {createRequire} from 'node:module';
import {mkdtempSync, readFileSync, rmSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// Exercise the actual production dependency chain, without reading the user's
// Vercel configuration or invoking its credentials/provider transport.
const require = createRequire(import.meta.url);
const functionsRequire = createRequire(require.resolve('@vercel/functions'));
const oidcRequire = createRequire(functionsRequire.resolve('@vercel/oidc'));
const cliPath = oidcRequire.resolve('@vercel/cli-config');
const cli = oidcRequire('@vercel/cli-config');
const cliRequire = createRequire(cliPath);
const directories = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, {recursive:true, force:true}); });
function file(name) { const directory = mkdtempSync(join(tmpdir(), 'acquire-vercel-config-')); directories.push(directory); return join(directory, name); }

it('resolves a Zod 4 release containing the constrained-collection security fix', () => {
  const [major, minor, patch] = cliRequire('zod/package.json').version.split('.').map(Number);
  expect(major).toBe(4);
  expect(minor > 6 || minor === 6 && patch >= 6).toBe(true);
});

it('round-trips global configuration and preserves supported extension fields', () => {
  const path = file('config.json');
  const config = {credStorage:'file', currentTeam:'synthetic-team', telemetry:{enabled:false, futureSetting:'retained'}, futureGlobal:{enabled:true}};
  cli.writeGlobalConfigFile(path, config);
  expect(cli.readGlobalConfigFile(path)).toEqual(config);
  expect(cli.parseGlobalConfig(JSON.parse(readFileSync(path, 'utf8')))).toEqual(config);
});

it('round-trips synthetic auth configuration through private files and honours skipWrite', () => {
  const path = file('auth.json');
  const config = {token:'synthetic-config-token', refreshToken:'synthetic-refresh-token', expiresAt:2000000000};
  cli.writeAuthConfigFile(path, config);
  expect(cli.readAuthConfigFile(path)).toEqual(config);
  expect(statSync(path).mode & 0o777).toBe(0o600);
  const before = readFileSync(path, 'utf8');
  cli.writeAuthConfigFile(path, {...config, token:'replacement-fixture-token', skipWrite:true});
  expect(readFileSync(path, 'utf8')).toBe(before);
});

it('retains actionable validation for invalid global and auth values', () => {
  expect(() => cli.parseGlobalConfig({credStorage:'unsupported'})).toThrow('Invalid value for `credStorage`');
  expect(() => cli.parseAuthConfig({token:123})).toThrow();
});
