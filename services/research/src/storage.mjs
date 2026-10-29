export function coordinatorStorage(pool, namespace) {
  const scoped = client => ({
    async get(key) {
      return (await client.query('SELECT value FROM research_service.state WHERE namespace=$1 AND key=$2', [namespace,key])).rows[0]?.value;
    },
    async put(key, value) {
      await client.query('INSERT INTO research_service.state(namespace,key,value) VALUES($1,$2,$3) ON CONFLICT(namespace,key) DO UPDATE SET value=EXCLUDED.value', [namespace,key,JSON.stringify(value)]);
    },
  });
  return {
    ...scoped(pool),
    async transaction(work) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='3s'");
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['research-provider:'+namespace]);
        const result = await work(scoped(client));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
    },
  };
}

// Cache misses are safe. This bounded process-local cache is deliberately not a second database.
export function memoryCache(maxEntries = 128) {
  const entries = new Map();
  return {
    async match(request) { return entries.get(request.url)?.clone(); },
    async put(request, response) {
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > 128 * 1024) return;
      entries.delete(request.url);
      entries.set(request.url, new Response(bytes, {status:response.status,headers:response.headers}));
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
    },
  };
}
