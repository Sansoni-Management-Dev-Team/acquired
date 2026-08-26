import "server-only";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString && process.env.NODE_ENV === "production") throw new Error("DATABASE_URL is required in production");

export const db = connectionString ? drizzle({ client: neon(connectionString), schema }) : null;
export function requireDb() { if (!db) throw new Error("Database is not configured"); return db; }
