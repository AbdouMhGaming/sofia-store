# Phase 4 — POS, cash sales and receipts

Current phase: **4**. Next: **5 — storefront checkout**.

## Implemented scope

- `/pos`: exact barcode lookup (leading zeroes preserved), dedicated keyboard-wedge
  scanner input with Enter, manual search, quantities and cash/change confirmation.
- `/pos/historique` and `/pos/tickets/:id`: saved, numbered receipts; reloading or
  reprinting reads the existing sale and never creates a payment.
- `/pos/sessions`: opening cash, gross sales, refunds, expected cash, counted cash,
  signed discrepancy and a required closing explanation.
- `/pos/reglages`: owner/manager receipt address, phone and footer. Empty business
  details remain visibly unconfigured, never invented.
- One initial physical drawer, **Caisse principale**. Only its opener can sell;
  another cashier cannot mix money into that session. Managers may close another
  operator's drawer with an explicit count and reason.
- Cashiers access the POS and their own receipts/session history. Owners/managers
  access all receipts, receipt settings, fixed-amount discounts and returns.
- Manager-only partial returns with per-line restock choice. Damaged returns can
  refund cash without putting an item back on sale. Full voids require the
  original still-open drawer, no previous return, all quantities and full restock.

## Financial and stock rules

All amounts are integer DZD centimes. The server supplies prices, costs and
metadata; a changed expected price causes a conflict rather than a silent charge.
Discounts require a manager and reason. Order discounts use exact largest-remainder
allocation across lines. Partial return amounts use cumulative proportional
rounding so returning all quantities refunds exactly the original net total.

Sales, payment, stock deductions and movement/audit records commit together.
Returns likewise commit cash ledger and optional restock together. Reserved stock
is never sold. A refund uses the current drawer, including when the original sale
belongs to an earlier closed session; it does not rewrite the closed count.
Original receipts retain product, price, cost and business-detail snapshots.
No completed sale/payment is deleted through the application.

Financial writes use READ COMMITTED plus explicit register/product/variant/stock
row locks. Repeatable-read snapshots are unsuitable for re-reading a price or
refund quantity after waiting for a lock.

Request IDs are retained for sale, refund, opening and closing retries. The browser
must save the exact pending request before sending; failed storage blocks the
operation. An unreadable stored request is not silently discarded. After a
connection failure the operator may retry the same request, recover a receipt,
or explicitly abandon it through the server. A recovery 404 alone does **not**
unlock the basket: a delayed original request might still arrive.

Server-side cancellation serializes on the same drawer lock and either returns
the already committed result or records a permanent cancellation tombstone.
Only that confirmation permits editing and a new request ID. Never expire these
tombstones independently of the corresponding financial-idempotency policy.

## Verification and remaining gates

`pnpm run typecheck` passes.

`pnpm --filter @workspace/scripts exec tsx ../lib/db/tools/verify-pos.ts`
passed against development MySQL: exact totals/change, immutable snapshots,
price conflicts, permission checks, reserved stock, damaged/partial returns,
voids, register discrepancy, identical retries, last-unit contention and
purchase-versus-cancellation races. Sequential fixtures roll back; committed
concurrency fixtures are removed by their exact verification-owned IDs.

Signed-in browser verification passed the full cash-sale lifecycle: open with
1,000 DA; scan the same verification barcode twice; charge 200.02 DA from 300 DA;
save/reload the same receipt with 99.98 DA change; return/restock one unit for
100.01 DA; close with 1,100.01 DA and zero discrepancy. MySQL checks independently
confirmed the single payment, return, stock balance and closed count. Only the
temporary verification account/product/financial records were removed afterward.
No browser console or API errors were reported. This test used a manager account;
cashier-specific authorization was checked in the backend service tests, not a
separate signed-in cashier browser session.

Receipt previews offer 58/80 mm content widths and print-only receipt styling.
Browser printer settings must match the actual paper. Physical scanner, printer,
cutting, margins, encoding and cash handling have **not** been verified. This is
not a certified fiscal invoice implementation. Do not invent a tax registration,
VAT treatment, statutory return policy or mandatory receipt information.

The POS requires a working connection. No offline sale queue is implemented.
Real Hostinger upload-directory permissions/redeployment persistence, production
configuration, backups/restore, staff lifecycle, Safe-POS migration and real
hardware acceptance remain later gates. Online checkout is still disabled.
