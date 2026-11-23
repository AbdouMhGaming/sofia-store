# Phase 6 — fulfillment and payment settlement

The owner chose support for both staff collection and courier collection with a
later payout. This phase implements manual, audited operations, not a courier,
banking, payment-gateway, email or SMS integration.

## Staff screens and lifecycle

Owner and manager accounts use **Administration → Commandes**. Cashiers do not
gain management access. The order list supports status and payment filters; each
detail has physical-goods, courier and shop-money panels.

1. **PENDING → CONFIRMED:** confirm before the unconfirmed reservation expires.
   Choose STAFF or COURIER for delivery. Pickup must use STAFF. Confirmation keeps
   the reserved quantity; confirmed reservations no longer auto-expire.
2. **CONFIRMED → PREPARING → READY:** prepare the order without taking it out of stock.
3. **Delivery READY → DISPATCHED:** remove both on-hand and reserved quantities in
   one atomic update. Courier collection requires a carrier and tracking number.
4. **DISPATCHED → DELIVERED:** record physical delivery only. No money is inferred.
5. **Collection and receipt:** courier collection is an explicit attestation after
   delivery; it creates an outstanding courier receivable, not shop income.
   A separately recorded shop receipt completes ordinary delivered orders.
6. **Pickup READY → COMPLETED:** cash receipt and physical handover happen in the
   same transaction; an active till is required.

PENDING/CONFIRMED/PREPARING/READY orders can be cancelled and release their holds
once. Expiry affects only PENDING orders. Dispatched or handed-over goods must use
the physical return workflow, not cancellation.

Every operation requires a reason. Actor and events are saved. Existing quote,
price, delivery fee, policy and receipt-setting snapshots are not rewritten.

## Actual payments, not assumed income

- STAFF delivery collection records the complete customer total, with no
  courier-withheld deduction.
- COURIER collection has two distinct steps: the courier collected from the
  customer, then the shop actually received a payout.
- A courier payout records its actual **net amount plus explicit withheld fee =
  original customer total**. The customer’s quoted shipping charge is not used as
  an invented carrier expense.
- CASH receipts attach to the active register session and save tendered/change.
  Managers can record an online-order cash entry in the active till; the entry
  records the actual operator. POS selling permissions remain unchanged.
- BANK receipts/refunds are manual records requiring a real reference. They have
  no register session or cash tendered amount and do not change drawer cash.
  Nothing initiates or verifies an external bank/CCP transfer.
- A receipt records the original total once per order, not a partial payout.
  A bank transfer covering several orders must be manually allocated to the
  individual orders; there is no automatic transfer matching or batch payout UI.

Drawer expected cash is opening float + POS cash sales + online cash receipts
− POS cash refunds − online cash refunds. Online amounts appear separately on
the sessions screen and closing summary. Bank entries never enter that formula.

## Physical returns and refunds

Phase 6 supports **whole-order returns and whole-merchandise refunds**, not partial
online line/quantity returns or split customer payments.

- Start RETURNING after dispatch, delivery or completion. This does not restock or refund.
- Physically receive the complete return, explicitly selecting which complete
  variant quantities are sellable. Only those quantities return to on-hand stock.
  Unticked/damaged goods are not made sellable. The order becomes RETURNED.
- Refund separately once the returned goods have been received and customer
  payment has been recorded, either to the courier or directly to the shop.
- Refund amount includes the complete merchandise subtotal plus an explicit
  delivery-fee refund portion between zero and the original fee. Saved
  `amountMinor` is the inclusive refund, not subtotal-only.
- Cash refunds require an open till with sufficient expected cash. Bank refunds
  need a manual reference. One refund ledger entry is allowed per order.
- A shop-funded refund before courier payout does **not** clear the courier's
  original outstanding money. A later courier payout is allowed without turning
  RETURNED back into COMPLETED. Courier-issued refunds are not represented as
  shop-funded refunds; automated courier adjustments are not implemented.

An ordinary refund reverses money, not its original immutable receipt. Both
records remain in history and have separate printable, non-fiscal internal receipts
at `/admin/commandes/:id/recu/:paymentId`.

## Retry and race safety

Actions and payments use UUID command keys bound to order, operator and exact
payload. Completed retries recover the saved result without repeating stock or
money movements. Changed-payload reuse is rejected.

The browser validates, saves and reads back the complete pending request before
sending. Until it is resolved, new operations are blocked, including after a reload
or navigation to another order. Recovery is a protected GET. Unknown/404 is not
proof of cancellation. Explicit abandonment either returns an already-completed
result or persists a cancellation tombstone that rejects a delayed original POST.
The UI unlocks only after a confirmed result and verified local pending-key removal.

All stock movements are row-locked, and updates preserve the on-hand/reserved
constraint without an intermediate invalid balance. Cash entries and drawer close
serialize on the register lock. Prices and fees use bounded integer centimes.

## Verification and remaining gates

`pnpm --filter @workspace/scripts exec tsx ../lib/db/tools/verify-fulfillment.ts`
checks actual development MySQL transactions with rollback fixtures, then isolated
committed fixtures for duplicate concurrent receipts and receipt-versus-drawer-close
races. It cleans only its exact owned records and preserves store configuration.

The browser fixture helper is
`artifacts/api-server/tools/fulfillment-browser-check.ts` with prepare/verify/cleanup
modes. Credentials and the private confirmation capability are temporary/private.
Browser verification uses only manual BANK ledger entries so it never touches an
existing real cash drawer. Cash, refunds and closing races are covered by isolated
backend register fixtures.

Reports, staff account management, notification automation/provider decisions,
Hostinger production setup and persistent-upload verification, backup restore,
real printer/scanner tests and Safe-POS cutover remain unfinished launch work.
No notification is sent by these operations and there is no claim of launch readiness.
