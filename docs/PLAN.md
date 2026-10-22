# Invoice Scanner — Plan

Scan a supplier invoice (PDF/image upload or e-invoice URL), extract it with Gemini,
match or create the supplier, let the user review it, then post it as a **bill** to an
accounting destination. Zoho Books is the default destination.

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

Source files: stored in Turso as metadata only; the bytes go to object storage
(Vercel Blob / S3 / R2 — decide in Phase 1; local `./uploads` in dev).

## Zoho Books mapping

| Invoice | Zoho Books |
|---|---|
| supplier | Contact with `contact_type: vendor` (`/contacts`) |
| invoice | Bill (`POST /bills`) — supplier invoices are bills, not invoices |
| line item | `line_items[]`: `description`, `quantity`, `rate`, `discount`, `account_id`, `tax_id` |
| tax rate | Matched to `/settings/taxes` by percentage; unmatched → warn in preview |
| original file | `POST /bills/{id}/attachment` |

Auth: OAuth 2.0 refresh token from a Zoho **Self Client** (single org) to start;
move to a proper OAuth redirect flow with tokens stored per org when multi-tenant.
Scopes: `ZohoBooks.contacts.ALL, ZohoBooks.bills.ALL, ZohoBooks.settings.READ`.
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

**Phase 1 — Upload → extract → preview**
- Upload page (drag & drop + URL field), `POST /api/invoices`, file storage.
- Run extraction, persist, redirect to preview.
- Preview page with editable form and totals checks.
- Fixtures: a handful of real (anonymized) invoices + recorded Gemini outputs for tests.

**Phase 2 — Suppliers & Zoho export**
- Supplier resolution + diff UI, supplier list page.
- Export endpoint, tax mapping UI, expense account selection, duplicate guard.
- Error surfacing from Zoho (validation messages back into the form).

**Phase 3 — Hardening & extras**
- Structured e-invoice parsers (UBL/CII/Peppol, Greek myDATA if needed).
- Auth (single-user password or Auth.js) — required before deploying.
- Invoice list/search, re-run extraction, batch upload.
- Additional connectors (QuickBooks, Xero, webhook) via `Connector`.
- Deploy to Vercel + Turso; secrets in Vercel env.

## Open questions

1. Which country/tax regime are the invoices from? Drives date formats, tax-ID field in Zoho
   (`vat_reg_no` / `gst_no` / ...) and whether to support local e-invoice formats.
2. Line items: post as free-text lines against one expense account, or match Zoho **items**
   (inventory) by SKU/name?
3. Single Zoho organization, or several (multi-tenant OAuth)?
4. Where should original files live (Vercel Blob, S3/R2, Google Drive)?
5. Who uses it — just you, or a team (determines auth)?
