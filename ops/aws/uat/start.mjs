import { pathToFileURL } from 'node:url';

export const UAT_ORIGIN = 'https://app.acquire.pajamaprofits.net';
export const UAT_DATABASE_HOST = 'acquire-n8n-develop.cluster-cjaq4yw64sj8.ap-southeast-2.rds.amazonaws.com';
export const UAT_TABLES = Object.freeze(['public.user', 'public.session', 'public.account', 'public.organization',
  'public.member', 'public.mandates', 'public.targets', 'public.contacts']);

/** Validate before connecting; never log a URL, credential or certificate. */
export function uatDatabaseConfig(env) {
  try {
    if (env.NODE_ENV !== 'production' || env.DATABASE_DRIVER !== 'postgres'
      || env.APP_URL !== UAT_ORIGIN || env.NEXT_PUBLIC_APP_URL !== UAT_ORIGIN
      || env.AWS_UAT_DATABASE_HOST !== UAT_DATABASE_HOST || env.AWS_UAT_DATABASE_NAME !== 'acquire') throw Error();
    for (const flag of ['RESEARCH_ENABLED', 'COMMUNICATIONS_RUNTIME_ENABLED', 'CAMPAIGN_N8N_ENABLED'])
      if (env[flag] !== 'false') throw Error();
    const url = new URL(env.DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== UAT_DATABASE_HOST
      || (url.port && url.port !== '5432') || url.pathname !== '/acquire' || !url.username) throw Error();
    if (url.searchParams.has('sslmode') && url.searchParams.get('sslmode') !== 'verify-full') throw Error();
    if (['sslcert', 'sslkey', 'sslrootcert', 'ssl', 'uselibpqcompat'].some(k => url.searchParams.has(k))) throw Error();
    url.searchParams.delete('sslmode'); // pg must use the explicit verified CA below.
    const encoded = env.DATABASE_SSL_CA_BASE64;
    if (!encoded || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw Error();
    const ca = Buffer.from(encoded, 'base64').toString('utf8');
    if (!ca.startsWith('-----BEGIN CERTIFICATE-----') || !ca.trimEnd().endsWith('-----END CERTIFICATE-----')) throw Error();
    return { connectionString: url.toString(), ssl: { ca, rejectUnauthorized: true },
      connectionTimeoutMillis: 8000, statement_timeout: 5000 };
  } catch { throw Error('AWS UAT database configuration unavailable'); }
}

/** Catalog reads only. This never repairs or initializes an empty database. */
export async function verifyUatSchema(client) {
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '5s'");
    const result = await client.query(`SELECT coalesce(array_agg(name) FILTER
      (WHERE pg_catalog.to_regclass(name) IS NULL), ARRAY[]::text[]) AS missing
      FROM unnest($1::text[]) AS required(name)`, [UAT_TABLES]);
    if (result.rows.length !== 1 || !Array.isArray(result.rows[0].missing) || result.rows[0].missing.length)
      throw Error('UAT schema prerequisites unavailable');
  } finally {
    try { await client.query('ROLLBACK'); } catch { /* Connection may not have opened. */ }
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const config = uatDatabaseConfig(process.env);
    const { default: pg } = await import('pg');
    await verifyUatSchema(new pg.Client(config));
    // Retain these TLS settings for all subsequent application connections too.
    process.env.DATABASE_URL = config.connectionString;
    process.env.DATABASE_SSL_CA = config.ssl.ca;
    delete process.env.DATABASE_SSL_CA_BASE64;
    if (!process.argv.includes('--check')) await import('./runtime.mjs');
    else console.log('UAT configuration and minimum application catalog prerequisites verified read-only.');
  } catch {
    process.stderr.write('AWS UAT startup unavailable; review isolated configuration and approved schema prerequisites.\n');
    process.exitCode = 1;
  }
}
