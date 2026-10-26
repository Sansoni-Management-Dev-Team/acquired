import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { agentDatabaseConfig, assertAgentDatabaseIdentity } from './agent-mode-local-database.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
if (readdirSync(root).some(name => /^\.env(?:\.|$)/.test(name) && name !== '.env.example')) {
  throw Error('Authenticated route server requires a worktree without dotenv credentials.');
}
const database = new pg.Client({ connectionString: agentDatabaseConfig().url });
await database.connect();
try {
  assertAgentDatabaseIdentity((await database.query("SELECT current_database() AS database,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()")).rows[0]);
} finally { await database.end(); }

// No inherited provider credentials or worker configuration. No migrations.
const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'SYSTEMROOT', 'CI'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
Object.assign(env, {
  NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1',
  APP_URL: 'http://127.0.0.1:3218', NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3218',
  DATABASE_DRIVER: 'postgres', DATABASE_URL: agentDatabaseConfig().url,
  BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
  // Expose the same Agent setup surface as the isolated app. The suite blocks
  // execution mutations; no worker or provider credentials are configured.
  AGENT_MODE_EXPLORATION_ENABLED: 'true',
  AGENT_DURABLE_STATE_ENABLED: 'true', AGENT_NATIVE_EXECUTION_ENABLED: 'true',
  AGENT_WORKER_SCOPE_MODE: 'registered',
  AGENT_WORKER_RUNTIME_ID: 'route-coverage-local',
});
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', '3218'], { cwd: root, env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
