// Shared by container services and an eventual edge router. Rendezvous hashing
// keeps an account on one shard and moves only affected accounts when shards change.
export function accountKey(actor) { return JSON.stringify([actor.organizationId, actor.userId]); }
function hash(value) {
  let result = 2166136261;
  for (const byte of new TextEncoder().encode(value)) { result ^= byte; result = Math.imul(result, 16777619); }
  result ^= result >>> 16; result = Math.imul(result, 0x85ebca6b); result ^= result >>> 13;
  return result >>> 0;
}
export function shardFor(actor, shardIds) {
  let selected; let score = -1;
  for (const id of shardIds) {
    const next = hash(JSON.stringify([accountKey(actor), id]));
    if (next > score || (next === score && id < selected)) { score = next; selected = id; }
  }
  if (!selected) throw new Error('At least one WhatsApp shard is required');
  return selected;
}
export function serviceConfig(env = {}) {
  const integer = (name, fallback, min, max) => {
    const value = Number(env[name] ?? fallback);
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid ${name}`);
    return value;
  };
  const shardId = env.WHATSAPP_SHARD_ID || 'primary';
  const shards = env.WHATSAPP_SHARDS ? JSON.parse(env.WHATSAPP_SHARDS) : { [shardId]: null };
  if (!shards || Array.isArray(shards) || typeof shards !== 'object' || !Object.hasOwn(shards, shardId)) throw new Error('Shard configuration must include this service');
  for (const [id, value] of Object.entries(shards)) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) throw new Error('Invalid shard ID');
    if (value == null && id === shardId) continue;
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Shard URLs must be HTTP(S) origins');
  }
  return { shardId, shards, shardIds: Object.keys(shards).sort(),
    deliveryHourly: integer('WHATSAPP_CAMPAIGN_HOURLY_CAP', 5, 1, 100),
    deliveryDaily: integer('WHATSAPP_CAMPAIGN_DAILY_CAP', 20, 1, 1000),
    deliverySpacingMs: integer('WHATSAPP_CAMPAIGN_SPACING_MS', 60000, 1000, 3600000),
    maxSessions: integer('WHATSAPP_MAX_SESSIONS', 32, 1, 1000),
    poolSize: integer('WHATSAPP_DB_POOL_SIZE', 12, 2, 100),
    leaseMs: integer('WHATSAPP_LEASE_MS', 60000, 15000, 300000),
    restoreIntervalMs: integer('WHATSAPP_RESTORE_INTERVAL_MS', 30000, 1000, 300000),
    connectSpacingMs: integer('WHATSAPP_CONNECT_SPACING_MS', 500, 0, 10000),
    maxRssMb: integer('WHATSAPP_MAX_RSS_MB', 768, 64, 16384),
    historyMessages: integer('WHATSAPP_HISTORY_MESSAGES', 1000, 1, 5000),
    historyContacts: integer('WHATSAPP_HISTORY_CONTACTS', 5000, 1, 50000),
    historyBytes: integer('WHATSAPP_HISTORY_BYTES', 2097152, 1024, 16777216),
  };
}
