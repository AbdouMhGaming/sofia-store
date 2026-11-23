# SOFIA STORE

An Algerian women's fashion boutique with one shared backend for the storefront,
management, and POS. This is a phased development build, not ready to
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
- Current Phase 3 behavior, CSV format, image constraints and Hostinger storage
  requirement: `docs/phase3-catalog.md`.
- POS permissions, financial rules, recovery, receipts and hardware gates:
  `docs/phase4-pos.md`.
- Cart, 58-wilaya home/desk settings, private order recovery and reservations:
  `docs/phase5-checkout.md`.
- Order fulfillment, collection, courier settlement, physical returns and
  cash/bank refund rules: `docs/phase6-fulfillment.md`.
- Owner-only retail reports, recognition dates, estimated margins and CSV:
  `docs/phase7-reports.md`.

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

Current phase: **Phase 7 — reporting and staff management**.
Reports are implemented; secure staff controls are the next separate task.
Next phase: **Phase 8 — hardening and Hostinger preparation**.
Category CRUD, variant editing, barcode labels, CSV preview/atomic import/export,
and detailed stock history are implemented. The image pipeline now uses a private
filesystem directory configured with `SOFIA_UPLOAD_DIR`; Replit storage code and
dependencies were removed. Authenticated upload, optimization, photo ordering,
replacement, visibility and deletion protection passed local API/disk-fixture tests.
Everything is intended to be hosted on Hostinger Business or Cloud managed hosting,
not VPS. Do not require a Replit bucket, use deployment-managed/temporary folders
for customer photos, or claim actual Hostinger permissions/redeploy persistence
verified. Those account-specific checks remain open for staging/deployment.
The active owner account was created through the one-time activation process.

Cash POS, receipt history, manager returns/voids and register reconciliation are
implemented. Backend financial/concurrency checks and a signed-in browser
sale/return/closure journey passed. Verification fixtures were cleaned without
altering real store records. See `docs/phase4-pos.md` for outstanding hardware gates.

Cart/checkout, pending unpaid orders, atomic stock reservations, configurable
home/desk fees and delivery times for all 58 wilayas, reservation expiry and basic
staff cancellation are implemented. Checkout availability and real delivery fees,
delays, reservation duration and terms are owner-configured; do not seed business
values or override the owner's current checkout setting. See `docs/phase5-checkout.md`.

Order confirmation/preparation/dispatch/delivery, distinct staff/courier collection,
actual courier cash/bank payouts, whole-order physical returns and separately
recorded refunds are implemented. Cash entries feed the active POS drawer;
bank entries never do. Actions and payments use durable operator/order-bound
idempotency, recoverable browser pending requests and server-side abandonment.
See `docs/phase6-fulfillment.md` for exact limits and verification.

Owner reports separate commercial activity, physical returns, actual cash/bank
flows and an as-of courier balance. Margins use historical costs and actual recorded
fees; categories are explicitly current. JSON/CSV are owner-only, bounded and
read-only. See `docs/phase7-reports.md` for the basis and verification.

Staff account management, notification automation/provider decisions,
Hostinger production setup, restore rehearsal, hardware verification and Safe-POS
migration remain launch work. Do not imply unavailable screens implement them.
