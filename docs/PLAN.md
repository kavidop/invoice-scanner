# Invoice Scanner — Plan

Scan a supplier invoice (PDF/image upload or e-invoice URL), extract it with Gemini,
match or create the supplier, let the user review it, then post it as a **bill** to an
accounting destination. Zoho Books is the default destination.

## Decisions

| Question | Decision |
|---|---|
| Country / tax regime | **Greece.** DD/MM dates, `1.234,50` amounts, ΦΠΑ 24/13/6 (17/9/4 islands), ΑΦΜ with or without the `EL` prefix, myDATA ΜΑΡΚ. Zoho on the EU data centre (`ZOHO_DC=eu`), supplier ΑΦΜ in `vat_reg_no`. |
| Product lines | **Match Zoho items.** Per line: the item linked to this supplier product before, else catalogue matches (same code, or name similarity), else create a new item with a user-edited name and code. The supplier code ↔ Zoho item link is kept in the app (`products`, `product_links`). |
| Zoho organizations | **Two.** Each is a destination (`zoho-books:<org id>`) with its own vendors, items, taxes and remembered choices. The invoice's buyer ΑΦΜ picks the organization; the user can switch. |
| Original files | **Google Drive** (Phase 3). |
| Users / login | **A team**, authenticated by Google IAM in front of Cloud Run (Phase 3). |

## Stack

| Concern | Choice | Why |
|---|---|---|
| App | Next.js 16 (App Router, TypeScript, Tailwind 4) | One codebase for UI and API routes |
| Extraction | Gemini via `@google/genai` | Reads PDFs and images natively; structured JSON output via `responseJsonSchema` |
| Validation | Zod 4 | One schema for the Gemini JSON schema, runtime parsing and TS types |
| Database | Turso (libSQL) + Drizzle ORM | SQLite semantics, local `file:` DB in dev, hosted in prod, no driver changes |
| Destination | Zoho Books REST v3 | Default; behind a `Connector` interface so others can be added |
| Tests | Vitest | Fast unit tests for schema, matching and connector mapping |

## Flow

```
 upload / URL ──► ingest ──► Gemini extract ──► supplier match ──► preview & edit ──► export
                   │              │                   │                  │               │
                hash, store   Invoice JSON      local DB, then      user confirms   Zoho: upsert
                source file   + confidence      destination         or fixes        vendor, create
                                                                                    bill, attach PDF
```

1. **Ingest** — `POST /api/invoices` accepts `multipart/form-data` (file) or `{ url }`.
   - Files: PDF, PNG, JPEG, WEBP, HEIC. SHA-256 hash to reject duplicate uploads.
   - URLs: fetch server-side. If the response is a PDF/image, treat it as a file.
     If it is HTML, strip scripts/styles and pass the text. If it is structured
     e-invoice XML (UBL / CII / Peppol / Factur-X / myDATA), parse it directly —
     no LLM needed — and map to the same `Invoice` shape (Phase 3).
   - Guard against SSRF: only `https`, block private IP ranges, cap size and time.
2. **Extract** — `src/lib/gemini/extract.ts` sends the document plus a system prompt and the
   JSON schema derived from `InvoiceSchema`, `temperature: 0`. Result is re-validated with Zod
   and stored in `invoices.extracted`. Model id is configurable (`GEMINI_MODEL`).
3. **Supplier resolution** (in order, first hit wins):
   1. Local `suppliers` by normalized tax ID.
   2. Local `suppliers` by normalized name (`normalizeName` strips case, accents, legal suffixes).
   3. Destination search (`connector.findSupplier`) — links the result locally.
   4. Otherwise mark as **new**; the preview shows "will create supplier".
   If extracted details differ from the stored supplier (address, email, IBAN), the preview
   shows a diff and the user chooses whether to update.
4. **Preview** — `/invoices/[id]`: original document side-by-side with an editable form
   (header, supplier, line items table, taxes, totals). `checkTotals()` flags lines and totals
   that don't add up; low `confidence` is highlighted. Saving writes `invoices.reviewed`.
5. **Export** — `POST /api/invoices/[id]/export?destination=zoho-books`:
   upsert vendor → create bill → upload original as attachment → record in `exports`.
   Duplicate guard: same supplier + invoice number already exported → block unless forced.

## Data model (`src/db/schema.ts`)

- `suppliers` — local registry (name, normalized name, tax ID, contact, address).
- `supplier_links` — supplier ↔ destination external id (e.g. Zoho `contact_id`).
- `invoices` — source info, status (`uploaded → parsed → reviewed → exported | failed`),
  raw `extracted` JSON and user-confirmed `reviewed` JSON.
- `exports` — one row per push attempt with request/response for audit.
- `products` — a supplier's product as seen on their invoices: supplier code (when printed) or
  normalized description, last price/unit, how many invoices it appeared on.
- `product_links` — product ↔ Zoho item, per organization.
- `tax_mappings` — remembered rate → Zoho tax, per organization.

Source files: stored in Turso as metadata only; the bytes go to file storage
(local `./uploads` in dev, Google Drive in production — Phase 3).

## Zoho Books mapping

| Invoice | Zoho Books |
|---|---|
| supplier | Contact with `contact_type: vendor` (`/contacts`); tax number in the field named by `ZOHO_TAX_ID_FIELD`, IBAN in notes, currency set on create |
| invoice | Bill (`POST /bills`) — supplier invoices are bills, not invoices |
| line item | `line_items[]`: `description` (SKU — text), `quantity`, `rate`, `unit`, `account_id`, `tax_id`. A line discount is folded into `rate` (Zoho's line discounts depend on an org setting) and noted in the description |
| tax rate | One tax per line, from its first rate. Suggested from a remembered choice, else matched to `/settings/taxes` by percentage; the user confirms. Lines with several taxes need a Zoho tax group |
| expense account | Chosen per invoice (optionally per line) from active expense / COGS / other-expense / fixed-asset accounts; remembered per supplier |
| original file | `POST /bills/{id}/attachment` (PDFs and images only) |

Auth: OAuth 2.0 refresh token from a Zoho **Self Client** (single org) to start;
move to a proper OAuth redirect flow with tokens stored per org when multi-tenant.
Scopes: `ZohoBooks.contacts.ALL, ZohoBooks.bills.ALL, ZohoBooks.settings.READ, ZohoBooks.accountants.READ`
(the last one is for the chart of accounts).
Data centre (`ZOHO_DC`) must match the account (`com`, `eu`, `in`, `com.au`, ...).

Getting a refresh token:
1. https://api-console.zoho.com → *Add Client* → *Self Client*.
2. *Generate Code* with the scopes above (10 min validity).
3. Exchange it:
   ```sh
   curl -X POST "https://accounts.zoho.com/oauth/v2/token" \
     -d grant_type=authorization_code -d client_id=... -d client_secret=... -d code=...
   ```
4. Put `refresh_token` in `.env.local`. Organization id: Zoho Books → Settings → Organization profile.

## Phases

**Phase 0 — Environment (done)**
Next.js scaffold, Turso/Drizzle schema + first migration, Zod invoice schema, Gemini
extraction function, Zoho Books client + connector, supplier name normalization,
`/api/health`, Vitest.

**Phase 1 — Upload → extract → preview (done)**
- Upload page (drag & drop + URL field) and recent-invoices list.
- `POST /api/invoices`: magic-byte type detection, 14 MB cap, SHA-256 duplicate detection
  (a failed duplicate is retried), original stored via `FileStorage` (local `./uploads` for now).
- URL ingest: https only, private/loopback addresses blocked on every redirect hop, size and
  time limits; PDFs/images are treated as files, HTML is reduced to bare markup, XML passed as text,
  JS-only pages rejected with a hint to upload the PDF.
- Extraction runs synchronously in the request; failures are stored on the row with the error.
- `/invoices/[id]`: original document beside an editable form (invoice, supplier, lines with
  per-line taxes, totals, notes), live totals checks with one-click recalculation, confidence
  badge, save (validated server-side into `reviewed`), reset to extracted, re-extract.
- `GEMINI_MOCK=true` returns a sample extraction so the UI works without an API key.
- Still to do: a handful of real (anonymized) invoices + recorded Gemini outputs as fixtures.

Known limits to revisit: extraction blocks the request for 10–30 s (move to a background job
if it becomes a problem); the URL guard checks DNS before fetching, so DNS rebinding is not
fully prevented; local-disk storage won't survive a serverless deploy.

**Phase 2 — Suppliers & Zoho export (done)**
- Export panel under the review form (`src/lib/invoices/export.ts`, `export-panel.tsx`), enabled once
  the review is saved and blocked while there are unsaved edits.
- Supplier resolution: local by tax ID, then normalized name (a name match with a different tax ID
  is rejected); field-by-field diff with checkboxes to update the stored supplier.
- Vendor choice: the linked vendor, or destination search results ranked by normalized name /
  email, or "create new"; optionally push updated details to the existing vendor.
- Tax mapping per rate and expense account per invoice/line, both remembered
  (`tax_mappings`, `supplier_links.default_account_id`).
- Duplicate guard: same supplier + invoice number already exported here, the invoice itself already
  exported, or the bill number already in Zoho for that vendor → blocked unless "Export anyway".
- Every attempt is recorded in `exports` with the request and Zoho's error body; errors are shown
  in the panel and in the export history.
- `/suppliers` list. `DESTINATION_MOCK=true` gives an in-memory Zoho for trying the flow.
- Not verified against a live Zoho org yet: the connector is covered by tests with stubbed HTTP only.

**Phase 2b — Greece, two organizations, products (done)**
- Extraction prompt for Greek invoices; `buyer` (name, ΑΦΜ) and myDATA `mark` added to the
  invoice schema and the review form. ΜΑΡΚ goes to the bill's `reference_number`.
- Name matching transliterates Greek → Latin and drops Greek legal forms (Α.Ε., Ε.Π.Ε., Ι.Κ.Ε., ...),
  so "ΑΛΦΑ ΧΗΜΙΚΑ Α.Ε." matches "Alfa Chimika S.A.". ΑΦΜ compared without the `EL` prefix.
- `ZOHO_ORGANIZATIONS` (JSON) lists the organizations with their ΑΦΜ; one Zoho login (refresh
  token) serves both and its access token is shared.
- Products step in the export panel (see Decisions). New items are created with the chosen
  account as purchase account, the vendor as preferred vendor, type `ZOHO_ITEM_TYPE`
  (default `inventory`, which needs inventory tracking and a stock account in Zoho), and selling
  price = purchase price as a starting point. Item lines post to the item's own account.
- `/suppliers/[id]` shows the supplier's products and their Zoho items per organization.
- Not verified against live Zoho organizations yet (stubbed HTTP tests + in-memory mock only).

**Phase 3 — Deploy on Google Cloud**
- **Hosting:** Cloud Run (container from `next build` standalone output), region `europe-west1`
  or `europe-west8`; Turso stays as the database (or a Turso region close to it).
- **Login:** Cloud Run with IAP (Identity-Aware Proxy) enabled: only members of a Google group
  get through, no login code in the app. The app reads the verified user from the IAP JWT
  (`x-goog-iap-jwt-assertion`, audience-checked) and records who reviewed/exported each invoice.
- **Files:** `GoogleDriveStorage` implementing `FileStorage`: the Cloud Run service account writes
  originals into a Shared Drive folder (`Invoices/<year>/<supplier>/<number>.pdf`), the DB keeps the
  Drive file id, the preview streams it through the app so team members don't need Drive access.
- **Secrets:** Gemini key, Zoho client/refresh token, Turso token in Secret Manager.
- **Greek e-invoices:** links from Greek e-invoicing providers (the QR/URL on the invoice) are
  already fetched as HTML/PDF; add direct parsing of myDATA / Peppol BIS (UBL) XML when we see real
  samples. Credit notes (Πιστωτικό) → Zoho vendor credits.
- **Extras:** invoice list search/filters, batch upload, background extraction if 10–30 s blocking
  becomes a problem.

## Open questions

1. Do both organizations have **inventory tracking** enabled in Zoho Books? If not, new items should
   be created as `purchases` (non-inventory) — set `ZOHO_ITEM_TYPE` accordingly.
2. Should new items get a selling price, or should it stay equal to cost until someone sets it?
3. Which Google Shared Drive/folder should hold the originals, and which Google group is the team?
4. A few real (anonymized) invoices and e-invoice links from your main suppliers, to tune the
   extraction and the item matching thresholds.
