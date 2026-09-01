import "server-only";
import { neon } from "@neondatabase/serverless";
import { drizzle as neonDrizzle } from "drizzle-orm/neon-http";
import { drizzle as postgresDrizzle } from "drizzle-orm/node-postgres";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core/session";
import { Pool } from "pg";
import { resolveDatabaseConfig } from "./driver";
import * as schema from "./schema";

type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

const globalForDatabase = globalThis as typeof globalThis & {
  projectAcquirePostgresPools?: Map<string, Pool>;
};

function getPostgresPool(connectionString: string) {
  const pools = globalForDatabase.projectAcquirePostgresPools ??= new Map<string, Pool>();
  const existingPool = pools.get(connectionString);
  if (existingPool) return existingPool;

  const pool = new Pool({ connectionString });
  pools.set(connectionString, pool);
  return pool;
}

function createDatabase(): Database | null {
  const config = resolveDatabaseConfig(process.env);
  if (!config) return null;

  if (config.driver === "postgres") {
    return postgresDrizzle({ client: getPostgresPool(config.connectionString), schema });
  }

  return neonDrizzle({ client: neon(config.connectionString), schema });
}

export const db = createDatabase();

export function requireDb() {
  if (!db) throw new Error("Database is not configured");
  return db;
}
