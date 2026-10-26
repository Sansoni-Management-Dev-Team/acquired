import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
// Next loads dotenv itself. Refuse local credentials instead of inheriting them.
if (readdirSync(root).some(name => /^\.env(?:\.|$)/.test(name) && name !== '.env.example')) {
  throw Error('Route smoke server requires a worktree without .env files; it must not load shared service credentials.');
}
const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'SYSTEMROOT', 'CI'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
Object.assign(env, {
  NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1',
  APP_URL: 'http://127.0.0.1:3217', NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3217',
  // Construct the real auth adapter, but make any unexpected database access fail.
  DATABASE_DRIVER: 'postgres', DATABASE_URL: 'postgresql://route_smoke:unused@127.0.0.1:1/route_smoke',
  BETTER_AUTH_SECRET: 'route-smoke-only-not-a-real-secret-0123456789',
});
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', '3217'], { cwd: root, env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
