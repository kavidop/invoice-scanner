import "server-only";
import { env } from "@/lib/env";
import { normalizeTaxId } from "@/lib/suppliers/normalize";
import { MOCK_ORGANIZATIONS, MockConnector } from "./mock";
import type { Connector } from "./types";
import { ZohoBooksConnector } from "./zoho-books";

/** One place bills can go: a Zoho Books organization. */
export type Destination = { key: string; label: string; taxId: string | null };

export class ConnectorNotConfiguredError extends Error {}

const connectors = new Map<string, Connector>();

function organizations() {
  return env().DESTINATION_MOCK ? MOCK_ORGANIZATIONS : env().ZOHO_ORGANIZATIONS;
}

export function listDestinations(): Destination[] {
  return organizations().map((org) => ({
    key: `zoho-books:${org.id}`,
    label: org.name,
    taxId: org.taxId ? normalizeTaxId(org.taxId) : null,
  }));
}

/** The organization whose ΑΦΜ is the invoice's buyer, else the first one. */
export function destinationForBuyer(buyerTaxId: string | null | undefined): Destination {
  const all = listDestinations();
  if (all.length === 0) {
    throw new ConnectorNotConfiguredError(
      "Zoho Books is not configured: set ZOHO_ORGANIZATIONS and the other ZOHO_* variables (see .env.example).",
    );
  }
  const taxId = buyerTaxId ? normalizeTaxId(buyerTaxId) : null;
  return all.find((d) => taxId && d.taxId === taxId) ?? all[0];
}

export function getConnector(key: string): Connector {
  const cached = connectors.get(key);
  if (cached) return cached;

  const e = env();
  const org = organizations().find((o) => `zoho-books:${o.id}` === key);
  if (!org) throw new ConnectorNotConfiguredError(`Unknown destination: ${key}`);

  let connector: Connector;
  if (e.DESTINATION_MOCK) {
    connector = new MockConnector(org);
  } else {
    if (!e.ZOHO_CLIENT_ID || !e.ZOHO_CLIENT_SECRET || !e.ZOHO_REFRESH_TOKEN) {
      throw new ConnectorNotConfiguredError(
        "Zoho Books is not configured: set ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET and ZOHO_REFRESH_TOKEN (see docs/PLAN.md).",
      );
    }
    connector = new ZohoBooksConnector({
      dc: e.ZOHO_DC,
      clientId: e.ZOHO_CLIENT_ID,
      clientSecret: e.ZOHO_CLIENT_SECRET,
      refreshToken: e.ZOHO_REFRESH_TOKEN,
      organizationId: org.id,
      organizationName: org.name,
      taxIdField: e.ZOHO_TAX_ID_FIELD,
      itemType: e.ZOHO_ITEM_TYPE,
    });
  }
  // One instance per organization so tax, account and item lists are cached between requests.
  connectors.set(key, connector);
  return connector;
}

/** Default expense account configured for an organization, if any. */
export function configuredExpenseAccount(key: string): string | undefined {
  return organizations().find((o) => `zoho-books:${o.id}` === key)?.expenseAccountId;
}

export { rateKey } from "./types";
export type {
  BillMapping,
  Connector,
  ExternalAccount,
  ExternalItem,
  ExternalSupplier,
  ExternalTax,
} from "./types";
