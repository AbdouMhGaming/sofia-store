# Phase 5 — cart, checkout and delivery settings

Current: **Phase 5**. Next: **Phase 6 — order confirmation, fulfillment and cash settlement**.

## Owner settings

`/admin/vente-en-ligne` contains the owner's requested **58-wilaya** service table,
codes 01–58, with French/Arabic names, an enable switch, separate home and courier-desk
fees, and separate minimum/maximum delivery days. Blank means **not configured**,
not free. Only a zero explicitly entered by the owner means zero charge. No tariff
or delivery time is seeded.

The owner also controls the unconfirmed-order reservation duration (15–10080
minutes), pickup fee, bilingual customer terms and exact pickup address. The
owner-provided address is prefilled:
**Rue colonel Amirouche, Oued Rhiou, Relizane**.

Checkout is off by default. Activation requires a receiving mode, a reservation
duration, customer terms in both languages, and complete prices/delays or pickup
details for each enabled mode. Owners can save; managers can read. Cashiers cannot
access settings or customer order details.

## Customer flow

- `/panier`: device-local cart with exact variant selection, quantity adjustment
  and removal. Maximum 20 variants, 20 units per variant.
- `/commande`: French/Arabic RTL checkout, anonymous CSRF protection, configured
  wilaya and home/desk selection, or store pickup. Desk delivery requires a commune,
  not an invented courier-desk street address.
- The server rechecks publication (`ACTIVE`, never `PREVIEW`), price and available
  STORE inventory. It computes fees, totals and delivery-day range. A quote does
  not reserve stock. Changed prices, fees or terms require a new reviewed quote.
- Submission saves an **unpaid**, pending-confirmation order and reserves stock
  atomically. Cash is collected later on delivery/pickup, never falsely recorded
  as collected online.
- `/commande/confirmation`: capability-protected saved order, masked phone,
  original tariffs/ETA/terms and reservation deadline in Africa/Algiers time.
  Capability tokens are not placed in URLs or logs; they are kept in this tab.

Customer contact/address data is available only through protected staff endpoints,
not public recovery responses. There is no card gateway, email/SMS service,
courier integration or online cash settlement in this phase.

## Retries and inventory

The exact pending submission and a random 256-bit capability token must be saved
before sending. Failed browser storage prevents sending; corrupt pending data
blocks checkout instead of silently discarding it. Failed requests stay locked.
A recovery 404 is not permission to submit again under a new reference.

Explicit abandonment either returns the existing committed order or persists a
permanent request tombstone. Retrying that reference cannot create a late order.
No customer cancellation of an already accepted order is implied by this action:
staff cancel existing orders separately with a reason.

Reservations change `reserved`, not `onHand`. POS and stock adjustments already
respect `onHand - reserved`. Cancellation releases once, without a refund or
physical stock increase because online checkout collected no money.

Pending reservations expire according to the owner's configured duration. A
bounded background sweep runs every 30 seconds and at startup. Quote/submission
routes also sweep first. Expiry uses a separate transaction before new-order
product locks, avoiding a product/inventory lock-order inversion with POS.
The service serializes order lifecycle/configuration/attempt records through a
database gate and uses READ COMMITTED plus row locks. Do not remove these rules
when adding Phase 6 fulfillment.

`/admin/commandes` and `/admin/commandes/:id` provide the protected basic order
list, details, reservation event history and reasoned cancellation. Shipping,
confirmation, pickup completion, returns after fulfillment and cash reconciliation
are **Phase 6**, not implemented by these basic controls.

## Verification

- Workspace types and additive Prisma migration passed.
- `pnpm --filter @workspace/scripts exec tsx ../lib/db/tools/verify-checkout.ts`
  passed development MySQL checks for all 58 unpriced defaults, home/desk tariffs
  and ETAs, owner permissions, publication rules, private recovery, exact totals,
  immutable order snapshots, reservation release/expiry, same-key retries, late
  cancellation safety and concurrent checkout/POS competition for the last unit.
- Sequential fixtures rolled back. Committed concurrency fixtures were removed
  by their exact verification-owned IDs. Temporary test configuration was restored
  in the same transaction, never published as real business settings.
- Browser verification passed owner settings save/reload for all 58 rows, distinct
  home/desk fees and ETAs, zero-cost pickup, anonymous cart/desk checkout, exact
  totals, one unpaid order, French/Arabic RTL confirmation, staff cancellation and
  reservation release. MySQL independently confirmed one order and no remaining
  reservation. Temporary configuration and verification-owned data were cleaned.
- The browser pass found and fixed a cold-reload CSRF startup race. Focused
  verification confirmed session GET completes before automatic recovery POST,
  including repeated cold reloads in French and Arabic. It used an existing
  verification order, not additional customer orders. Closed orders show their
  historical total, not money currently owed.
- Configuration loading/error states are explicit rather than falsely claiming
  checkout is closed. Settings switches expose their actual accessible on/off
  state. Staff order pages refresh every 20 seconds while open.

## Launch gates

Keep real checkout disabled until actual fees, ETAs, duration and bilingual terms
are confirmed, products/stock are verified, and Phase 6 operational workflows are
ready. The process-local public rate limiter is not a complete production
anti-abuse strategy; production needs appropriate distributed limits/monitoring
and a deliberate COD confirmation policy. Backup/restore, privacy/retention,
Hostinger persistence and real scanner/printer tests remain launch gates.
