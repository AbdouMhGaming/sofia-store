# Development migrations and Hostinger deployment

## Target safety

The owner confirmed the supplied `DB_*` credentials point to a development database.
Do not use these scripts against a production target without reconfirming the target,
reviewing every migration, and taking a provider-managed backup first.

The application reads `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASS`, and optional `DB_PORT`
(default 3306). No credential is committed, returned to clients, or printed by tooling.
`SESSION_SECRET` is separately required. Do not replace existing secrets.

The runtime constructs a MySQL URL internally. `SOFIA_MYSQL_URL` is an ephemeral
Prisma CLI variable only, not a second database or persisted secret. The starter
PostgreSQL `DATABASE_URL` is intentionally not used.

## Commands

From the repository root:

```
pnpm --filter @workspace/db run generate
pnpm --filter @workspace/db run validate
pnpm --filter @workspace/db run migrate
pnpm --filter @workspace/db exec node tools/seed.mjs
pnpm run typecheck
```

The checked-in migrations are additive. `migrate deploy` is explicit: it never runs
at API startup, never resets a database, and uses Prisma's migration history.
The seed is rerunnable and does not overwrite existing products or credentials.
It creates reference roles/location/categories and six clearly labeled photo previews.
No real prices, sizes, stock quantities, users, payments, or sales are fabricated.

To add a future migration, generate SQL for the reviewed schema difference in a
development environment, inspect the SQL for destructive statements, test it against
a separate development database, and commit the schema and migration together.
Never use reset, force push, or DROP as a schema-repair shortcut.

## Initial owner

Configure `OWNER_SETUP_TOKEN` securely (at least 32 random characters), open
`/admin/login`, and use the secured activation screen with the intended owner email.
The setup key is never part of a URL or log. A unique temporary password is generated
using cryptographic randomness and displayed once in the secure app response.
Copy it into a password manager, sign in, and change it immediately. Repeated activation
is blocked after the first owner is created. Remove the setup secret after activation.

No publicly known default password exists and no unauthenticated, unprotected admin
registration is available.

## Hostinger production build checklist

Use a supported Node.js LTS version and pnpm. Build the web client with `BASE_PATH=/`
and a valid build-time `PORT` per its Vite configuration; the API build command is
`pnpm --filter @workspace/api-server run build`. Run the API Node entry point with the
platform-supplied `PORT`, and serve the built SPA from the same origin with API paths
forwarded to the API. A final Hostinger-specific start configuration is deferred until
staging setup; the development preview workflow is not the production run command.

Provision a separate production MySQL database and a fresh production session secret.
Use Hostinger's secure configuration interface, never a public `.env` or frontend
environment variable. Run reviewed migrations from an environment allowed to reach
that database, during an explicit deployment step. Do not assume a private Hostinger
address is reachable from Replit.

## Provider backups and restore rehearsal (not yet tested)

Hostinger owns backups for this external database. Before launch:

1. Enable/confirm the plan's database backup retention and access.
2. Take a provider-supported backup/export before each production migration.
3. Restore a backup into a separate disposable database, never over the live store.
4. Configure staging against that restored database and reconcile row counts,
   variant balances, reservations, sale totals, and migration history.
5. Record the recovery point and elapsed recovery time, then restrict access to the
   restored copy because it may contain customer information.

This document is a procedure, not evidence of a tested backup. Restore acceptance
remains open until a real provider backup has been restored and reconciled.
