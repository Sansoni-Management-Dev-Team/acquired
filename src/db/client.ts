import {acquisitionWorkflowPool} from './acquisition-workflow-pool';
import {acquisitionWorkflowContext} from '@/lib/acquisition-workflow-context';
import {backgroundPool} from "./background-pool";
import { observeResearchDatabase } from "@/lib/research-request-observability";
import "server-only";
import { attachDatabasePool } from "@vercel/functions";
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

  const ca = process.env.DATABASE_SSL_CA;
  const pool = new Pool({
    connectionString,
    ...(ca ? { ssl: { ca, rejectUnauthorized: true } } : {}),
    max: 5,
    connectionTimeoutMillis: 15_000,
    idleTimeoutMillis: 5_000,
  });
  attachDatabasePool(pool);
  const bounded = acquisitionWorkflowPool(backgroundPool(pool));
  pools.set(connectionString, bounded);
  return bounded;
}

function createDatabase(): Database | null {
  const config = resolveDatabaseConfig(process.env);
  if (!config) return null;

  if (config.driver === "postgres") {
    return observeResearchDatabase(postgresDrizzle({ client: getPostgresPool(config.connectionString), schema }), "postgres");
  }

  return observeResearchDatabase(neonDrizzle({ client: neon(config.connectionString), schema }), "neon");
}

export const db = createDatabase();

export function requireDb() {
  if(acquisitionWorkflowContext()?.id && resolveDatabaseConfig(process.env)?.driver!=="postgres") throw new Error("Workflow execution requires the transaction-capable PostgreSQL driver");
  if (!db) throw new Error("Database is not configured");
  return db;
}
