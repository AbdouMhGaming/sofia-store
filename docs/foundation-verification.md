# Foundation verification

This records the foundation milestone, not the current feature boundary.
See `phase4-pos.md` for the subsequent POS implementation and verification.

This is evidence for the initial foundation only, not the full retail acceptance suite.

## Passed

- Prisma schema validation and additive development migrations.
- Repository-wide TypeScript checks.
- Public health, store, catalog, and categories API responses.
- Six supplied-photo previews returned from actual MySQL data, without invented
  variants, prices, stock, sales, or customers.
- Anonymous management reads rejected with HTTP 401.
- Mutations without a CSRF token rejected with HTTP 403.
- Desktop (1440 × 1000) and mobile (390 × 844) homepage visual checks: supplied logo
  and complete banner visible; no replacement imagery or overlaid text.
- Actual stock-adjustment service verified in a MySQL transaction:
  exact integer balances, repeat-request idempotency, conflicting reference rejection,
  protection of reserved quantities, correct movement signs, attributed audit entries.
  All verification records were rolled back.

Repeat the stock service check with:

```
pnpm --filter @workspace/scripts exec tsx ../lib/db/tools/verify-stock.ts
```

## Still open

- Owner activation, first sign-in, forced password change, and authenticated management
  journey require the secure one-time activation key and real owner setup.
- Concurrent last-item sales/reservations are not tested because checkout is not built.
- POS/scanner, receipt printing, sales, refunds, register closing, online checkout,
  orders, delivery fees, reports, CSV import/export, durable image uploads, backup
  restoration, Hostinger staging/production, and Safe-POS migration remain later phases.
- Development preview is deliberately excluded from search indexing. Production
  canonical URLs, sitemap, structured data, and indexing are a later deployment step.
