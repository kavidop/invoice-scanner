import "server-only";
import { env } from "@/lib/env";
import type { Connector } from "./types";
import { ZohoBooksConnector } from "./zoho-books";

export const DEFAULT_DESTINATION = "zoho-books";

export function getConnector(id: string = DEFAULT_DESTINATION): Connector {
  switch (id) {
    case "zoho-books": {
      const e = env();
      if (!e.ZOHO_CLIENT_ID || !e.ZOHO_CLIENT_SECRET || !e.ZOHO_REFRESH_TOKEN || !e.ZOHO_ORGANIZATION_ID) {
        throw new Error("Zoho Books is not configured: set the ZOHO_* variables in .env.local");
      }
      return new ZohoBooksConnector({
        dc: e.ZOHO_DC,
        clientId: e.ZOHO_CLIENT_ID,
        clientSecret: e.ZOHO_CLIENT_SECRET,
        refreshToken: e.ZOHO_REFRESH_TOKEN,
        organizationId: e.ZOHO_ORGANIZATION_ID,
        defaultExpenseAccountId: e.ZOHO_EXPENSE_ACCOUNT_ID,
      });
    }
    default:
      throw new Error(`Unknown destination: ${id}`);
  }
}

export type { Connector } from "./types";
