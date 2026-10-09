// Read-only comparison. Never copies data, changes schema or applies migrations.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { parseEnv } from "node:util";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import pg from "pg";

const queries = {
  version: "SELECT current_setting('server_version') version",
  ledger: "SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at",
  tables: "SELECT c.relname name,c.relrowsecurity rls,c.relforcerowsecurity forced_rls FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY 1",
  columns: "SELECT c.relname table_name,a.attname name,format_type(a.atttypid,a.atttypmod) type,a.attnotnull required,pg_get_expr(d.adbin,d.adrelid) default_value,a.attidentity identity,a.attgenerated generated FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname='public' AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped ORDER BY 1,2",
  constraints: "SELECT c.relname table_name,x.conname name,pg_get_constraintdef(x.oid) definition FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY 1,2",
  indexes: "SELECT tablename table_name,indexname name,indexdef definition FROM pg_indexes WHERE schemaname='public' ORDER BY 1,2",
  policies: "SELECT tablename table_name,policyname name,permissive,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' ORDER BY 1,2",
  roles: "SELECT rolname name,rolsuper superuser,rolbypassrls bypass_rls,rolcanlogin login FROM pg_roles WHERE rolname LIKE 'acquire_%' ORDER BY 1",
  grants: "SELECT table_name,grantee,privilege_type FROM information_schema.role_table_grants WHERE table_schema='public' AND grantee LIKE 'acquire_%' ORDER BY 1,2,3",
  functions: "SELECT p.proname name,pg_get_function_identity_arguments(p.oid) args,pg_get_functiondef(p.oid) definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind IN ('f','p') AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e') ORDER BY 1,2",
  triggers: "SELECT c.relname table_name,t.tgname name,pg_get_triggerdef(t.oid) definition,t.tgenabled enabled FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY 1,2",
  views: "SELECT viewname name,definition FROM pg_views WHERE schemaname='public' ORDER BY 1",
};

export function compareSnapshots(local, remote) {
  const differences = {};
  for (const key of Object.keys(queries)) {
    if (key === "version") continue;
    const a = new Set(local[key].map(value => JSON.stringify(value)));
    const b = new Set(remote[key].map(value => JSON.stringify(value)));
    const localOnly = [...a].filter(value => !b.has(value)).map(value => JSON.parse(value));
    const remoteOnly = [...b].filter(value => !a.has(value)).map(value => JSON.parse(value));
    if (localOnly.length || remoteOnly.length) differences[key] = { localOnly, remoteOnly };
  }
  return differences;
}

async function inspect(config, includeCounts) {
  const client = new pg.Client({ ...config, connectionTimeoutMillis: 10000, statement_timeout: 15000 });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const snapshot = {};
    for (const [key, query] of Object.entries(queries)) snapshot[key] = (await client.query(query)).rows;
    if (includeCounts) {
      snapshot.rowCounts = {};
      for (const table of snapshot.tables) {
        const quoted = '"' + table.name.replaceAll('"', '""') + '"';
        snapshot.rowCounts[table.name] = (await client.query(`SELECT count(*)::text count FROM public.${quoted}`)).rows[0].count;
      }
    }
    await client.query("ROLLBACK");
    return snapshot;
  } finally { await client.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [environmentFile, outputFile, ...flags] = process.argv.slice(2);
  if (!environmentFile || !outputFile || flags.some(flag => flag !== "--counts")) throw new Error("Usage: node scripts/check-local-db-parity.mjs <restricted-remote-env-file> <report.json> [--counts]");
  const env = parseEnv(readFileSync(environmentFile, "utf8"));
  if (!env.DATABASE_URL || ["localhost", "127.0.0.1"].includes(new URL(env.DATABASE_URL).hostname)) throw new Error("Remote environment must identify a non-local database");
  const ca = env.DATABASE_SSL_CA_BASE64 ? Buffer.from(env.DATABASE_SSL_CA_BASE64, "base64").toString("utf8") : env.DATABASE_SSL_CA;
  const [local, remote] = await Promise.all([
    inspect({ connectionString: "postgresql://project_acquire:project_acquire@127.0.0.1:5434/project_acquire" }, flags.includes("--counts")),
    inspect({ connectionString: env.DATABASE_URL, ssl: { ...(ca ? { ca } : {}), rejectUnauthorized: true } }, flags.includes("--counts")),
  ]);
  const differences = compareSnapshots(local, remote);
  const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
  const migrations = journal.entries.map(entry => ({ name: entry.tag, hash: createHash("sha256").update(readFileSync(`drizzle/${entry.tag}.sql`)).digest("hex") }));
  const unknownMigrationHashes = [...new Set([...local.ledger, ...remote.ledger].map(entry => entry.hash))].filter(hash => !migrations.some(migration => migration.hash === hash));
  const report = { checkedAt: new Date().toISOString(), scope: "public application schema, campaign roles and migration ledger; no data copied", local, remote, differences, unknownMigrationHashes };
  mkdirSync(resolve(outputFile, ".."), { recursive: true, mode: 0o700 });
  writeFileSync(outputFile, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ localVersion: local.version, remoteVersion: remote.version, migrations: { local: local.ledger.length, remote: remote.ledger.length }, differences: Object.fromEntries(Object.entries(differences).map(([key, value]) => [key, { localOnly: value.localOnly.length, remoteOnly: value.remoteOnly.length }])), unknownMigrationHashes: unknownMigrationHashes.length, report: resolve(outputFile) }, null, 2));
  if (Object.keys(differences).length || unknownMigrationHashes.length) process.exitCode = 1;
}
