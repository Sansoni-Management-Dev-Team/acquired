import { readFileSync, watchFile } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function summarizeResearchLog(contents) {
  const groups = new Map();
  const seen = new Set();
  let first, last, latestReader;
  for (const line of contents.split('\n')) {
    const separator = line.indexOf(' ');
    if (line.slice(0, separator) !== 'research-provider') continue;
    let event;
    try { event = JSON.parse(line.slice(separator + 1)); } catch { continue; }
    if (!['request_completed', 'request_failed'].includes(event.event)) continue;
    // Retries may retain a request ID. Preserve distinct attempts and only
    // collapse repeated copies of the same timestamped terminal event.
    const id = event.requestId && event.timestamp && `${event.requestId}:${event.event}:${event.timestamp}`;
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    if (event.timestamp) { first ||= event.timestamp; last = event.timestamp; }
    if (event.reader) latestReader = event.reader;
    let reason = event.event === 'request_completed' ? 'succeeded' : event.category || 'unknown';
    if (reason === 'domain_backoff' && typeof event.reader?.domainActive === 'boolean') reason = event.reader.domainActive ? 'domain_in_flight' : 'domain_cooldown';
    const key = `${event.provider}|${reason}|${event.httpStatus || 'transport'}`;
    if (!groups.has(key)) groups.set(key, { provider: event.provider, reason, status: event.httpStatus || 'transport', samples: [] });
    groups.get(key).samples.push(Number.isFinite(event.elapsedMs) ? event.elapsedMs : 0);
  }
  const requests = [...groups.values()].map(({ samples, ...group }) => {
    samples.sort((a, b) => a - b);
    return { ...group, count: samples.length, meanMs: Math.round(samples.reduce((a, b) => a + b, 0) / samples.length), p95Ms: samples[Math.max(0, Math.ceil(samples.length * .95) - 1)], workMs: samples.reduce((a, b) => a + b, 0) };
  }).sort((a, b) => b.count - a.count);
  return { first, last, latestReader, requests };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const path = resolve(args.find(arg => !arg.startsWith('--')) || '.local-data/dev-start.log');
  const print = () => {
    const result = summarizeResearchLog(readFileSync(path, 'utf8'));
    if (args.includes('--json')) return console.log(JSON.stringify(result, null, 2));
    console.log(`\nResearch log: ${path}\nWindow: ${result.first || 'no requests'} → ${result.last || 'no requests'}`);
    if (result.latestReader) console.log('Latest reader snapshot:', result.latestReader);
    console.table(result.requests);
    console.log('workMs sums request durations across parallel jobs; it is not wall-clock time.');
  };
  print();
  if (args.includes('--watch')) watchFile(path, { interval: 5000 }, print);
}
