import { sql } from "drizzle-orm";
import { connection } from "next/server";
import { db } from "@/db";
import { listDestinations } from "@/lib/connectors";
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
    gemini: e.GEMINI_MOCK ? "mock" : e.GEMINI_API_KEY ? `configured (${e.GEMINI_MODEL})` : "missing GEMINI_API_KEY",
    zohoBooks: e.DESTINATION_MOCK
      ? "mock"
      : e.ZOHO_REFRESH_TOKEN && e.ZOHO_ORGANIZATIONS.length > 0
        ? "configured"
        : "not configured",
    organizations: listDestinations().map((d) => d.label),
  });
}
