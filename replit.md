# SOFIA STORE

An Algerian women's fashion boutique with one shared backend for the storefront,
management, and planned POS. This is a phased development build, not ready to
replace the store's existing Safe-POS installation yet.

## Product constraints

- The owner confirmed the supplied Hostinger MySQL database is for development
  and their hosting plan supports Node.js.
- Use the supplied MySQL database, never substitute the starter PostgreSQL database.
- Never reveal credentials or log connection errors containing credentials.
- Use the uploaded official logo, hero banner, and actual product photos.
- Preserve the banner composition on desktop and mobile. No replacement imagery.
- French default, Arabic with RTL; all financial values use DZD integer centimes.
- No invented business prices, stock, sizes, testimonials, revenue, or customers.
- Current photo-derived labels are provisional PREVIEW listings, not verified offers.
- Online-first POS only. Real scanner/printer compatibility and safe offline operation
  must not be claimed without the appropriate real-world tests and user approval.
- Do not delete completed business records; archive products and use audited
  adjustment/refund workflows.

## Stack and structure

- pnpm workspace; React/Vite client at `artifacts/sofia-store`.
- Shared Express API at `artifacts/api-server`, served under `/api`.
- Prisma/MySQL schema and migrations at `lib/db/prisma`.
- OpenAPI contract at `lib/api-spec/openapi.yaml`; generated client/Zod packages.
- Architecture, schema plan, phase gates: `docs/architecture.md`.
- Migrations, secure owner activation, Hostinger staging and backup procedures:
  `docs/database-operations.md`.
- Current Phase 3 behavior, CSV format, image upload constraints and provisioning
  blocker: `docs/phase3-catalog.md`.

## Run and validate

- `pnpm --filter @workspace/db run generate`
- `pnpm --filter @workspace/db run validate`
- `pnpm --filter @workspace/db run migrate` — explicit additive migration deploy;
  never automatically run at app startup.
- `pnpm --filter @workspace/db exec node tools/seed.mjs` — rerunnable reference/photo
  preview seed; never creates fake stock or accounts.
- `pnpm --filter @workspace/api-spec run codegen`
- `pnpm run typecheck`
- Managed workflows: `artifacts/api-server: API Server`, `artifacts/sofia-store: web`.

Required secret names: `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASS`, `SESSION_SECRET`.
Optional `DB_PORT` defaults to 3306. Owner activation additionally needs a securely
configured `OWNER_SETUP_TOKEN` of at least 32 characters. Never store secret values
in files or memory. The built-in `DATABASE_URL` is not an application data source.

## Security and inventory

The user explicitly requested password hashes and one-time local owner setup.
The app uses scrypt, opaque hashed sessions, CSRF-protected mutations, role checks,
login throttling, and a required first-login password change.
Owner activation is disabled without the setup secret and cannot run twice.

Variant stock is centralized, row-locked, and adjusted transactionally with actor,
reason, and idempotency reference. Never expose costs through public catalog APIs.
Remote MySQL latency can exceed Prisma's default 5-second interactive transaction
limit: keep transactions bounded and short, and use the configured 30-second runtime
budget (60 seconds for the multi-record setup seed).

## Current phase boundary

Current phase: **Phase 3 — catalog and inventory**. Next: **Phase 4 — POS and receipts**.
Category CRUD, variant editing, barcode labels, CSV preview/atomic import/export,
and detailed stock history are implemented. New-photo upload workflow is implemented
but blocked on object storage provisioning; do not call it verified or Phase 3 finished.
The active owner account was created through the one-time activation process.

Cash checkout, sale receipts, orders/reservations, delivery, reports, staff account
management, Hostinger production setup, restore rehearsal, and Safe-POS migration
remain separate phases. Do not imply unavailable screens implement those functions.
