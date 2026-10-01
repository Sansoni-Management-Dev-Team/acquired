import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
const directory = resolve('.local-data/whatsapp');
mkdirSync(directory, { recursive: true, mode: 0o700 });
const envFile = resolve(directory, 'service.env');
if (!existsSync(envFile)) writeFileSync(envFile, `WHATSAPP_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}\nWHATSAPP_SERVICE_SECRET=${randomBytes(32).toString('hex')}\n`, { mode: 0o600 });
const env = { ...process.env, ...parseEnv(readFileSync(envFile, 'utf8')) };
// Compose uses only local Postgres. Never reads the production DATABASE_URL.
const result = spawnSync('docker', ['--context', 'orbstack', 'compose', '-f', 'compose.local.yml', 'up', '-d', '--build', '--wait', 'whatsapp'], { env, stdio: 'inherit' });
if (result.status !== 0) { console.error('WhatsApp failed health checks. Verify the approved local schema is installed. No migration was applied.'); process.exit(result.status || 1); }
console.info('WhatsApp ready on localhost:18095. Restart pnpm dev to enable the Settings connection.');
