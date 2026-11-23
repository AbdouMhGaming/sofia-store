# Phase 7 — actual retail reports

Owner page: `/admin/rapports`. Staff account controls remain the next separate task.
The page and both JSON/CSV endpoints are owner-only. No manager/cashier permissions
for POS or fulfillment were broadened. Reports never write financial records,
inventory, settings, reservations, sessions or drawer entries.

## Reading the figures

All amounts are integer DZD centimes. Every displayed figure derives from saved
retail records, not catalog previews or invented offers. The page separates:

1. **Merchandise activity:** POS at the original sale date, including sales currently
   marked voided/refunded; delivery at the `DELIVER` event, not dispatch or payout;
   pickup at its paid handover `RECEIPT` event. Delivery can be commercially complete
   but still unpaid.
2. **Merchandise returns:** POS refund items at the refund date; online merchandise
   at physical `RETURN_RECEIVE`, not at a later cash refund. A cash refund therefore
   does not reduce merchandise revenue a second time.
3. **Real shop money:** POS receipts at the sale date and refunds at their own date;
   online payments at their immutable payment date. Courier collection alone is
   not shop money. A courier payout's amount is already **net** of its actual fee.
   Cash and bank stay separate; bank never enters the drawer.
4. **Courier receivable as of the cutoff:** original gross total collected before
   the cutoff with no shop receipt before that cutoff, including older orders
   outside the start date. A shop-funded refund does not clear this debt. A receipt
   after the selected end date must not erase the earlier balance.

### Costs, discounts and estimated margin

POS line discounts include the saved allocated overall discount, including integer
rounding. Costs always use original item `unitCostMinor`, never current catalog
costs. Zero saved costs remain zero, with an explicit warning.

Returned sellable POS units reverse their saved cost; damaged units do not.
Online sellable returns use exact durable `WEB-RETURN-orderId-variantId` stock
movements, not free-text reasons. Whole-line web returns are the current supported
model; inconsistent partial movements refuse the report. A damaged return of a
shipment **never delivered** recognizes its cost as a loss at return receipt.
There was no sale or earlier cost expense to reverse.

- Merchandise net = original gross − saved discounts − physical merchandise returns.
- Net cost = saved sold cost − sellable returned cost + undelivered damaged losses.
- Merchandise margin = merchandise net − net cost.
- Net delivery contribution = delivery fees on actual shop receipts − delivery fees
  actually refunded − actual courier deductions on receipts.
- **Estimated overall margin** = merchandise margin + net delivery contribution.

The last measure deliberately combines merchandise activity with recorded
delivery-fee settlements. Payment/return periods may differ; a payout is not another
sale. This is an operational estimate, **not accounting profit or a fiscal report**:
taxes, overheads and unrecorded courier invoices are not invented.

## Dates, grouping and limits

- Inclusive local dates from 2000 through today, at most 366 days, Africa/Algiers.
  UTC+1 is valid throughout this supported modern reporting period.
- DAY/MONTH grouping and ALL/POS/ONLINE/PICKUP/DELIVERY filters.
- A single captured cutoff bounds today's flows and the outstanding balance.
  A past end date ends at 23:59:59.999 local, not the next day's first millisecond.
- Daily/monthly periods are zero-filled; empty results are real zero states.
  Refund-only or loss-only ranges can be negative and are not mistaken for empty.
- A non-locking repeatable-read transaction gives one consistent reporting snapshot.
  Financial writes retain their existing READ COMMITTED/locking rules.
- At most 5,000 records from each source and 20,000 expanded item lines per request.
  Exceeding these returns 413 with a narrower-range instruction, never partial totals.
  Unsafe integer arithmetic also refuses the report.
- Product/category names and classification are **current**, clearly labelled as
  such, because there is no saved historical category snapshot. Prices and costs
  remain historical. Product/category axes reconcile merchandise metrics; shipping
  and courier charges remain separate order-level adjustments, not fake item costs.

## Export and privacy

`GET /api/admin/reports` and `/api/admin/reports/export` accept the same filters.
CSV calls the same read/aggregation path, exporting the entire bounded result,
definitions, units, filters and cutoff. Columns use centimes explicitly; the format
is UTF-8, semicolon-separated and properly quoted. Text formula prefixes, including
leading whitespace/control characters, are neutralized; negative numeric amounts
remain numbers. Nothing is written to disk. Both responses are private/no-store.

The browser applies filter drafts explicitly and disables export for draft,
loading, failed or mismatched results. Server authorization is independent of
browser navigation. Reports do not load customer contact details or expose them
in the JSON/CSV.

The browser also sends the displayed result's fingerprint with the export. The
server compares all result values/classification, excluding volatile clock fields.
If a sale, payment, return or classification change alters the result between
viewing and downloading, it refuses with 409 and asks for refresh instead of silently
exporting different figures. “Appliquer” also refreshes unchanged filters.

## Verification

```
pnpm --filter @workspace/api-spec run codegen
pnpm run typecheck
pnpm --filter @workspace/scripts exec tsx ../lib/db/tools/verify-reports.ts
pnpm --filter @workspace/scripts exec tsx ../lib/db/tools/verify-reports-http.ts
```

The first verifier covers discounts, saved costs, partial POS refunds, damaged and
sellable returns, never-delivered losses, late payouts, refunds before payouts,
Alger midnight/month boundaries, leap/calendar/range bounds, safe arithmetic,
all channel/product/category/time reconciliations, empty/refund-only ranges,
CSV escaping and source/line limits. MySQL integration fixtures are isolated in
one transaction and deliberately rolled back, including their private register.

The HTTP verifier requires the running API. It creates disabled-password,
short-lived fixture accounts/sessions for owner/manager/cashier, verifies both
endpoints' permissions and matching exports, and deletes only those accounts.
No real owner credential or real till is used. Both verification tools refuse
`NODE_ENV=production`. The signed-in report UI was type-checked, not browser-driven.

## Still outside this task

Secure staff controls, automated notifications/provider selection, Hostinger
production hardening and upload persistence, backup restoration, real scanner/
receipt printer acceptance and Safe-POS migration remain launch gates. No schema
migration, production change, deployment or fake commercial history was introduced.
