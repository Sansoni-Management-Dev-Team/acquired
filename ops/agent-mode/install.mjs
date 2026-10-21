import { copyFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
mkdirSync('/install', { recursive: true });
for (const file of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) copyFileSync(`/workspace/${file}`, `/install/${file}`);
const result = spawnSync('pnpm', ['install', '--frozen-lockfile', '--network-concurrency=8', '--fetch-timeout=30000'], { cwd: '/install', stdio: 'inherit' });
process.exit(result.status ?? 1);
