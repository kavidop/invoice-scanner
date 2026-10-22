import "server-only";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { env } from "@/lib/env";
import * as schema from "./schema";

function connect() {
  const { TURSO_DATABASE_URL, TURSO_AUTH_TOKEN } = env();
  return drizzle(createClient({ url: TURSO_DATABASE_URL, authToken: TURSO_AUTH_TOKEN }), {
    schema,
  });
}

// Reuse one client across hot reloads in dev.
const globalForDb = globalThis as unknown as { db?: ReturnType<typeof connect> };

export function db() {
  globalForDb.db ??= connect();
  return globalForDb.db;
}

export { schema };
