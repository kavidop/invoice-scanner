import "server-only";
import { env } from "@/lib/env";
import { MockConnector } from "./mock";
import type { Connector } from "./types";
import { ZohoBooksConnector } from "./zoho-books";

export const DEFAULT_DESTINATION = "zoho-books";

export class ConnectorNotConfiguredError extends Error {}

let zoho: ZohoBooksConnector | undefined;

export function getConnector(id: string = DEFAULT_DESTINATION): Connector {
  switch (id) {
    case "zoho-books": {
      const e = env();
      if (e.DESTINATION_MOCK) return new MockConnector();
      if (!e.ZOHO_CLIENT_ID || !e.ZOHO_CLIENT_SECRET || !e.ZOHO_REFRESH_TOKEN || !e.ZOHO_ORGANIZATION_ID) {
        throw new ConnectorNotConfiguredError(
          "Zoho Books is not configured: set the ZOHO_* variables in .env.local (see docs/PLAN.md).",
        );
      }
      // One instance so the access token and tax/account lists are cached between requests.
      zoho ??= new ZohoBooksConnector({
        dc: e.ZOHO_DC,
        clientId: e.ZOHO_CLIENT_ID,
        clientSecret: e.ZOHO_CLIENT_SECRET,
        refreshToken: e.ZOHO_REFRESH_TOKEN,
        organizationId: e.ZOHO_ORGANIZATION_ID,
        taxIdField: e.ZOHO_TAX_ID_FIELD,
      });
      return zoho;
    }
    default:
      throw new Error(`Unknown destination: ${id}`);
  }
}

export { rateKey } from "./types";
export type { BillMapping, Connector, ExternalAccount, ExternalSupplier, ExternalTax } from "./types";
