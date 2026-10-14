import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

it('the built native service reaches its explicit startup guard without a framework marker dependency', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  // Deliberately exclude inherited credentials, provider settings and database URLs.
  const env:NodeJS.ProcessEnv = { PATH: process.env.PATH, NODE_ENV: 'test' };
  const build = spawnSync(process.execPath, [resolve(root, 'scripts/build-communications-service.mjs')], {
    cwd: root, env, encoding: 'utf8', timeout: 60_000,
  });
  expect(build.status, build.stderr).toBe(0);
  // No --serve: the actual bundle must reject before configuration, SQL or listening.
  const startup = spawnSync(process.execPath, [resolve(root, '.local-data/communications/service-build/service.cjs')], {
    cwd: root, env, encoding: 'utf8', timeout: 10_000,
  });
  expect(startup.status).toBe(1);
  expect(startup.stdout).toBe('');
  expect(startup.stderr).toBe('Communications startup unavailable; check private configuration and approved storage\n');
  expect(startup.stderr).not.toMatch(/MODULE_NOT_FOUND|server-only|Client Component/);
}, 75_000);
