import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
const directory = '.local-data/linkedin';
mkdirSync(directory, { recursive: true, mode: 0o700 });
mkdirSync(`${directory}/state`, { recursive: true, mode: 0o700 });
const path = `${directory}/service.env`;
if (!existsSync(path)) {
  const source = existsSync('.env.local') ? parseEnv(readFileSync('.env.local', 'utf8')) : {};
  const env = { LINKEDIN_SERVICE_SECRET: randomBytes(32).toString('hex'), LINKEDIN_ENCRYPTION_KEY: randomBytes(32).toString('base64'), LINKEDIN_ENABLE_FIXTURES: 'true', LINKEDIN_ALLOW_LIVE_SENDS: 'false', LINKEDIN_ALLOW_CAMPAIGNS: 'false', LINKEDIN_REPLY_MONITOR_ENABLED: 'true', ANONYMIZED_TELEMETRY: 'false' };
  // Optional model key stays in the ignored private file and only enters this local service.
  if (source.OPENAI_API_KEY) env.OPENAI_API_KEY = source.OPENAI_API_KEY;
  else if (source.OPENROUTER_API_KEY) env.OPENROUTER_API_KEY = source.OPENROUTER_API_KEY;
  writeFileSync(path, Object.entries(env).map(([k,v]) => `${k}=${JSON.stringify(v)}`).join('\n')+'\n', { mode: 0o600 });
}
chmodSync(path, 0o600);
const context = spawnSync('docker', ['context','show'], { encoding: 'utf8' });
if (context.stdout.trim() !== 'orbstack') throw new Error('Select the OrbStack Docker context before starting this local prototype');
const result = spawnSync('docker', ['compose','-f','services/linkedin/compose.local.yml','up','-d','--build'], { stdio: 'inherit' });
process.exit(result.status ?? 1);
