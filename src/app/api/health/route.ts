import { sql } from "drizzle-orm";
import { connection } from "next/server";
import { db } from "@/db";
import { env } from "@/lib/env";

/** Quick check that the dev environment is wired up. */
export async function GET() {
  await connection();
  const e = env();
  let database: "ok" | string = "ok";
  try {
    await db().run(sql`select 1`);
  } catch (err) {
    database = err instanceof Error ? err.message : String(err);
  }
  return Response.json({
    database,
    gemini: e.GEMINI_API_KEY ? `configured (${e.GEMINI_MODEL})` : "missing GEMINI_API_KEY",
    zohoBooks: e.ZOHO_REFRESH_TOKEN && e.ZOHO_ORGANIZATION_ID ? "configured" : "not configured",
  });
}
