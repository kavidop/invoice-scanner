import "server-only";
import { z } from "zod";

const EnvSchema = z.object({
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-flash-latest"),
  /** Return a canned extraction instead of calling Gemini (UI work without an API key). */
  GEMINI_MOCK: z.stringbool().default(false),

  TURSO_DATABASE_URL: z.string().default("file:local.db"),
  TURSO_AUTH_TOKEN: z.string().optional(),

  UPLOAD_DIR: z.string().default("./uploads"),

  ZOHO_DC: z.string().default("com"),
  ZOHO_CLIENT_ID: z.string().optional(),
  ZOHO_CLIENT_SECRET: z.string().optional(),
  ZOHO_REFRESH_TOKEN: z.string().optional(),
  ZOHO_ORGANIZATION_ID: z.string().optional(),
  ZOHO_EXPENSE_ACCOUNT_ID: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

/** Parsed lazily so `next build` works without secrets present. */
export function env(): Env {
  cached ??= EnvSchema.parse(
    Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== "")),
  );
  return cached;
}
