import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--authenticated')) {
  throw Error('Usage: node scripts/route-test-server.mjs [--authenticated]');
}
const authenticated = args[0] === '--authenticated';
const port = authenticated ? '3218' : '3217';
const origin = `http://127.0.0.1:${port}`;
// Next loads dotenv itself. Refuse local credentials instead of inheriting them.
if (readdirSync(root).some(name => /^\.env(?:\.|$)/.test(name) && name !== '.env.example')) {
  throw Error('Route test server requires a worktree without .env files; it must not load shared service credentials.');
}
const inheritedKeys = ['PATH', 'HOME', 'TMPDIR', 'SYSTEMROOT', 'CI'];
const env = Object.fromEntries(inheritedKeys.filter(key => process.env[key]).map(key => [key, process.env[key]]));
Object.assign(env, {
  NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1',
  APP_URL: origin, NEXT_PUBLIC_APP_URL: origin,
  // Construct the real auth adapter, but make any unexpected database access fail.
  DATABASE_DRIVER: 'postgres', DATABASE_URL: 'postgresql://route_smoke:unused@127.0.0.1:1/route_smoke',
  BETTER_AUTH_SECRET: 'route-smoke-only-not-a-real-secret-0123456789',
});
if (authenticated) {
  const { default: pg } = await import('pg');
  const { agentDatabaseConfig, assertAgentDatabaseIdentity } = await import('./agent-mode-local-database.mjs');
  const databaseUrl = agentDatabaseConfig().url;
  const database = new pg.Client({ connectionString: databaseUrl });
  await database.connect();
  try {
    const result = await database.query("SELECT current_database() AS database,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()");
    assertAgentDatabaseIdentity(result.rows[0]);
  } finally {
    await database.end();
  }
  // Expose Agent setup without starting workers or inheriting provider credentials.
  // The browser suite blocks execution mutations and checks fixture state.
  Object.assign(env, {
    DATABASE_URL: databaseUrl,
    BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
    AGENT_MODE_EXPLORATION_ENABLED: 'true',
    AGENT_DURABLE_STATE_ENABLED: 'true',
    AGENT_NATIVE_EXECUTION_ENABLED: 'true',
    AGENT_WORKER_SCOPE_MODE: 'registered',
    AGENT_WORKER_RUNTIME_ID: 'route-coverage-local',
  });
}
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', port], { cwd: root, env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
