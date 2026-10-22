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

  ZOHO_DC: z.string().default("eu"),
  ZOHO_CLIENT_ID: z.string().optional(),
  ZOHO_CLIENT_SECRET: z.string().optional(),
  ZOHO_REFRESH_TOKEN: z.string().optional(),
  /**
   * The Zoho Books organizations bills can go to, as JSON:
   * [{"id":"20012345","name":"Alpha Α.Ε.","taxId":"EL800000001"}, ...]
   * `taxId` (the company's ΑΦΜ) picks the organization from the invoice's buyer.
   */
  ZOHO_ORGANIZATIONS: z
    .string()
    .transform((value, ctx) => {
      try {
        return JSON.parse(value) as unknown;
      } catch {
        ctx.addIssue({ code: "custom", message: "ZOHO_ORGANIZATIONS must be JSON" });
        return z.NEVER;
      }
    })
    .pipe(
      z.array(
        z.object({
          id: z.string().min(1),
          name: z.string().min(1),
          taxId: z.string().optional(),
          /** Account used when no account was remembered for a supplier. */
          expenseAccountId: z.string().optional(),
        }),
      ),
    )
    .default([]),
  /** Contact field for the supplier tax number; vat_reg_no for Greek (EU) organizations. */
  ZOHO_TAX_ID_FIELD: z.string().default("vat_reg_no"),
  /** Zoho item type for items created from invoice lines: inventory, purchases, sales_and_purchases. */
  ZOHO_ITEM_TYPE: z.enum(["inventory", "purchases", "sales_and_purchases"]).default("inventory"),
  /** Use an in-memory fake Zoho Books (export flow without credentials). */
  DESTINATION_MOCK: z.stringbool().default(false),
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
