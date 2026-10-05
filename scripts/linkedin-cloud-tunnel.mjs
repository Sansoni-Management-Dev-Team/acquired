import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { isIP } from 'node:net';
const deployment = JSON.parse(readFileSync('.local-data/linkedin/cloud-deployment.json', 'utf8'));
if (isIP(deployment.address) !== 4) throw new Error('Invalid DigitalOcean test host address');
const host = `root@${deployment.address}`;
const control = '.local-data/linkedin/cloud-ssh-control';
if (process.argv[2] === 'stop') {
  const result = spawnSync('ssh', ['-S', control, '-O', 'exit', host], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}
if (process.argv.length > 2) throw new Error('Usage: node scripts/linkedin-cloud-tunnel.mjs [stop]');
const check = spawnSync('ssh', ['-S', control, '-O', 'check', host], { stdio: 'ignore' });
if (check.status === 0) {
  console.log('DigitalOcean tunnel is already running on http://127.0.0.1:18097');
} else {
  const result = spawnSync('ssh', ['-i', '.local-data/whatsapp/digitalocean_ed25519',
    '-o', 'UserKnownHostsFile=.local-data/linkedin/cloud-known-hosts', '-o', 'StrictHostKeyChecking=yes',
    '-o', 'ExitOnForwardFailure=yes', '-o', 'ConnectTimeout=10',
    '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3',
    '-M', '-S', control, '-f', '-N', '-L', '127.0.0.1:18097:127.0.0.1:18096', host], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
  console.log('DigitalOcean tunnel running on http://127.0.0.1:18097');
}
