import { afterEach, describe, expect, it, vi } from "vitest";
import { ZohoClient } from "@/lib/connectors/zoho-books/client";
import { buildBillPayload, ZohoBooksConnector } from "@/lib/connectors/zoho-books";
import { sampleInvoice } from "@/lib/invoice/sample";

const config = { dc: "eu", clientId: "id", clientSecret: "secret", refreshToken: "refresh", organizationId: "42" };

type Call = { url: URL; init: RequestInit };

function stubFetch(routes: Record<string, unknown>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL | string, init: RequestInit = {}) => {
      const url = new URL(input);
      calls.push({ url, init });
      if (url.hostname === "accounts.zoho.eu") return Response.json({ access_token: "tok", expires_in: 3600 });
      const key = `${init.method ?? "GET"} ${url.pathname.replace("/books/v3", "")}`;
      if (!(key in routes)) return Response.json({ code: 1002, message: `no route ${key}` }, { status: 404 });
      return Response.json({ code: 0, message: "success", ...(routes[key] as object) });
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("ZohoClient", () => {
  it("refreshes the token once and sends the organization id", async () => {
    const calls = stubFetch({ "GET /settings/taxes": { taxes: [] } });
    const client = new ZohoClient(config);
    await client.request("GET", "/settings/taxes");
    await client.request("GET", "/settings/taxes");

    expect(calls.filter((c) => c.url.hostname === "accounts.zoho.eu")).toHaveLength(1);
    const api = calls.filter((c) => c.url.hostname === "www.zohoapis.eu");
    expect(api[0].url.searchParams.get("organization_id")).toBe("42");
    expect((api[0].init.headers as Record<string, string>).Authorization).toBe("Zoho-oauthtoken tok");
  });

  it("turns a non-zero code into an error with Zoho's message", async () => {
    stubFetch({});
    await expect(new ZohoClient(config).request("GET", "/bills")).rejects.toThrow("no route GET /bills");
  });
});

describe("ZohoBooksConnector", () => {
  it("ranks vendors by normalized name and searches on a distinctive word", async () => {
    const calls = stubFetch({
      "GET /contacts": {
        contacts: [
          { contact_id: "2", contact_name: "Northwind Traders" },
          { contact_id: "1", contact_name: "NORTHWIND OFFICE SUPPLIES SA", currency_code: "EUR" },
        ],
      },
    });
    const found = await new ZohoBooksConnector(config).searchSuppliers(sampleInvoice.supplier);
    expect(found.map((f) => f.externalId)).toEqual(["1"]);
    const search = calls.find((c) => c.url.pathname.endsWith("/contacts"))!;
    expect(search.url.searchParams.get("contact_name_contains")).toBe("northwind");
  });

  it("creates a vendor with currency and configured tax ID field", async () => {
    const calls = stubFetch({
      "GET /settings/currencies": { currencies: [{ currency_id: "c-eur", currency_code: "EUR" }] },
      "POST /contacts": { contact: { contact_id: "v9", contact_name: "x" } },
    });
    const id = await new ZohoBooksConnector({ ...config, taxIdField: "vat_reg_no" }).upsertSupplier(sampleInvoice.supplier, {
      currency: "EUR",
    });
    expect(id).toBe("v9");
    const body = JSON.parse(calls.find((c) => c.init.method === "POST" && c.url.pathname.endsWith("/contacts"))!.init.body as string);
    expect(body).toMatchObject({ contact_type: "vendor", currency_id: "c-eur", vat_reg_no: "EL094012345" });
    expect(body.billing_address).toMatchObject({ city: "Athens", zip: "11526", country: "GR" });
  });

  it("builds bill lines with accounts, mapped taxes and discounts folded into the rate", () => {
    const payload = buildBillPayload(sampleInvoice, "v1", {
      taxes: { "24": "t24" },
      lineAccountIds: ["a1", "a2", "a3"],
    });
    expect(payload).toMatchObject({ vendor_id: "v1", bill_number: "INV-2026-0142", date: "2026-10-15" });
    expect(payload.line_items[0]).toMatchObject({ account_id: "a1", rate: 24.5, quantity: 10, tax_id: "t24" });
    expect(payload.line_items[0].description).toBe("PAP-A4-80 — A4 copy paper, 80 g/m², box of 5 reams");
    // 3 × 89.90 − 13.49 = 256.21 → 85.4033 per unit
    expect(payload.line_items[1].rate).toBe(85.4033);
    expect(payload.line_items[1].description).toContain("less discount 13.49");
  });

  it("uploads the original as a bill attachment", async () => {
    const calls = stubFetch({
      "POST /bills": { bill: { bill_id: "b1" } },
      "POST /bills/b1/attachment": {},
    });
    const result = await new ZohoBooksConnector(config).createBill(
      sampleInvoice,
      "v1",
      { taxes: {}, lineAccountIds: ["a", "a", "a"] },
      { data: Buffer.from("%PDF"), mimeType: "application/pdf", filename: "INV.pdf" },
    );
    expect(result).toEqual({ externalId: "b1", externalUrl: "https://books.zoho.eu/app/42#/bills/b1" });
    expect(calls.some((c) => c.url.pathname.endsWith("/bills/b1/attachment") && c.init.body instanceof FormData)).toBe(true);
  });
});
