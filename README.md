# Invoice Scanner

Upload a scanned supplier invoice (or paste an e-invoice URL), let Gemini extract the
supplier, line items, prices and taxes, review it, and post it as a bill to Zoho Books.

See [docs/PLAN.md](docs/PLAN.md) for the architecture and roadmap.

## Getting started

Requires Node.js 20.9+ (22 recommended).

```sh
npm install
cp .env.example .env.local   # then fill in GEMINI_API_KEY (and Zoho when you get there)
npm run db:migrate           # creates local.db (or migrates your Turso DB)
npm run dev
```

Open http://localhost:3000 and check http://localhost:3000/api/health.

No Gemini key yet? Set `GEMINI_MOCK=true` in `.env.local` and every upload returns a sample
extraction (with one deliberately wrong line total), which is enough to work on the UI.

### Database

Dev uses a local libSQL file (`TURSO_DATABASE_URL=file:local.db`), so no account is needed.
To use Turso:

```sh
turso db create invoice-scanner
turso db show invoice-scanner --url        # -> TURSO_DATABASE_URL
turso db tokens create invoice-scanner     # -> TURSO_AUTH_TOKEN
npm run db:migrate
```

After changing `src/db/schema.ts`, run `npm run db:generate` and commit the new migration.

## Scripts

| Script | |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` / `start` | Production build / serve |
| `npm run lint` / `typecheck` / `test` | Checks |
| `npm run db:generate` | Generate SQL migration from schema |
| `npm run db:migrate` | Apply migrations |
| `npm run db:studio` | Browse the DB |

## Layout

```
src/
  app/                    Next.js routes (UI + /api)
  db/                     Drizzle schema and client (Turso / libSQL)
  lib/invoice/schema.ts   Canonical Invoice schema (Zod) + totals checks
  lib/gemini/extract.ts   Gemini extraction
  lib/ingest/             File type detection, URL fetching (SSRF-guarded), HTML reduction
  lib/invoices/service.ts Ingest → store → extract → review workflow
  lib/storage/            Original document storage (local disk for now)
  lib/suppliers/          Supplier matching helpers
  lib/connectors/         Destination connectors (Zoho Books default)
drizzle/                  SQL migrations
docs/PLAN.md              Plan and roadmap
```
