# SOFIA STORE — architecture and phased delivery

## Purpose and current scope

One retail platform replaces Safe-POS only when the full acceptance checklist is passed.
The initial foundation is not a production-ready POS replacement.

The owner confirmed that the supplied Hostinger database is a **development database**
and that their Hostinger plan supports Node.js. Database connectivity was verified over
TLS before implementation. No production database is configured or modified.

## Architecture

- One React + Vite client serves public boutique pages and protected management routes.
- One Express/Node.js API owns authentication, validation, permissions, and inventory rules.
- Prisma with the MySQL provider uses only the supplied Hostinger database. The unused
  starter PostgreSQL setup is not an application data source.
- This adapts the preferred Next.js stack to the existing project while preserving a
  modular monolith: identity, catalog, inventory, later sales, orders, and reporting.
- No independent admin/POS databases, no SQLite, no pretend offline checkout.
- Financial values are integer DZD centimes. A displayed 1,000.50 DA is 100050 centimes.
- Photo previews are explicitly unpriced and have no invented stock or sizes.

## Implemented foundation schema

Source of truth: `lib/db/prisma/schema.prisma`.

| Tables | Relationships and purpose |
| --- | --- |
| users, roles, user_roles | Explicit staff permissions and required initial password change |
| sessions | Hashed opaque session identifiers, expiry, user and CSRF binding |
| owner_setup_claim | Singleton, transactionally claimed one-time owner activation |
| categories, products | Bilingual descriptions, publication state, unique product slug |
| product_images | Ordered photo metadata; packaged supplied assets only in this phase |
| sizes, colors, product_variants | Unique SKU/barcode and product-size-color combination |
| locations, inventory | Unique variant/location balance; on-hand and reserved quantities |
| stock_movements | Actor, reason, signed quantity, resulting balance, idempotency reference |
| audit_logs | Attributed catalog, login, password, and inventory events |
| store_settings | Configuration foundation |

Foreign keys prevent deletion of referenced business records. Completed business records
will be preserved, never deleted to correct a sale. Products are safely archived.
Database checks enforce nonnegative inventory, reservations not exceeding on-hand stock,
positive selling prices, and nonnegative costs.

Stock changes lock the variant/location row, validate the reserved balance, change the
balance, insert an idempotent movement, and append its audit entry in one transaction.
The same request ID cannot be reused for a different actor or payload.

## Planned schema extensions

These are a design plan, **not tables or features claimed implemented**:

- customers → customer_addresses.
- brands → products.
- suppliers → stock_receipts → stock_receipt_items → variants.
- register_sessions → sales → sale_items; payments reference the sale/order.
- refunds → refund_items referencing original sale items and stock movements.
- orders → order_items → stock_reservations; deliveries and order_status_history.
- configurable delivery_zones/fees; notification outbox for confirmed business events.

Historical line items will snapshot names, variants, quantities, unit price, cost, and
discounts. All checkout totals will be recalculated on the server. Both checkout modes
will use the same inventory rows and database transactions. Sales and checkout requests
will have unique idempotency keys. Repeated cancellations will release a reservation once.

## Authentication

The brief explicitly requests locally stored secure password hashes and one-time
temporary owner credentials, so this project uses local staff authentication rather
than introducing a different external identity provider.

- scrypt with random per-password salt; no plaintext password storage.
- cryptographic random session tokens; only token hashes stored server-side.
- HttpOnly, SameSite cookies; Secure when served over HTTPS.
- CSRF-protected mutations, login throttling, server-side role checks.
- One-time activation is disabled unless a secret `OWNER_SETUP_TOKEN` of at least 32
  characters is configured. It additionally requires the owner email.
- Activation returns a freshly generated temporary password once over the secure app
  response, never in application logs, source code, Git, or chat.
- A singleton claim prevents duplicate owner creation even under concurrent activation.
- The temporary password must be changed before any management access.
- Changing a password revokes all previous sessions.

## Asset handling

The supplied official logo and homepage banner are preserved and packaged with the
web application. The banner must not crop the models or add overlays.
Six real supplied clothing photos are explicitly labeled as previews; descriptive
names are provisional. No product prices, stock counts, materials, reviews, or sales
are invented. Publication needs owner-verified variants, prices, and stock.

New image uploads require a persistent Hostinger-compatible storage strategy in a
later phase; the initial admin deliberately selects only packaged supplied photos.
No upload to temporary Replit storage is represented as a durable upload.

## Delivery roadmap and gates

1. **Requirements and architecture:** inspect assets, confirm development target and
   Node.js support, verify database connectivity, design shared schema.
2. **Foundation:** initialize client/API and Prisma migrations, roles, session security,
   secure one-time owner activation and required password change.
3. **Catalog and inventory:** bilingual product management, variants, barcodes,
   receiving/adjustments, audited stock history. Follow-on gaps: category CRUD,
   variant editing, CSV import/export, persistent multi-image uploads.
4. **POS:** USB keyboard-wedge scanner, exact barcode lookup, cashier basket,
   transactional cash sale, idempotent retry, receipts at 58/80mm, receipt history.
5. **Storefront checkout:** basket, checkout validation, cash on delivery/store payment,
   secure order confirmation and tracking.
6. **Order operations:** reservation lifecycle, delivery-zone fees, pickup, safe
   cancellation, status transitions, configurable notification outbox.
7. **Reports:** actual daily/monthly sales, profit estimates, product/category
   breakdowns, channel comparison, CSV export.
8. **Hardening and deployment:** concurrency/security tests, Hostinger staging build,
   restore rehearsal, legal policy content approved by the owner.
9. **Hardware:** test the real USB scanner, browser printing, actual printer widths
   on the store computer. No compatibility claim until those tests pass.
10. **Safe-POS migration and launch:** inspect an export before designing import,
    reconcile stock/cash, training, production backup and staged cutover.

## Hosting and remaining inputs

Node.js support is owner-confirmed, not verified by logging into the hosting account.
Before deployment verify supported Node version (target a supported LTS release),
start-command configuration, TLS/reverse proxy setup, a real domain, persistent image
storage, and production remote-database restrictions.

The initial project preview is not a Hostinger production deployment. No production
URL is invented. No online payment gateway or full offline mode is included.

Still needed: secure owner activation, verified product/variant data and prices,
opening stock, delivery fees by wilaya, municipal addressing source, policies, return
rules, final store address/hours, scanner/printer models and physical tests, Safe-POS
export, and a separate production database before launch.
