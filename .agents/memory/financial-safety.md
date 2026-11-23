---
name: Financial transaction safety
description: Hostinger locking/constraint compatibility and why uncertain financial requests need durable cancellation.
---

Use READ COMMITTED with explicit row locks for cash-sale and refund writes that
re-read business data after waiting for another transaction.

**Why:** In MySQL REPEATABLE READ, a consistent snapshot established before a
locking read can remain stale after that lock becomes available. Locking alone
does not guarantee a subsequent ordinary read sees the new price or refund state.

**How to apply:** Preserve this isolation choice when extending financial writes
to orders and reservations; reason explicitly about lock ordering and current reads.

A missing receipt after a network failure does not prove a sale cannot still
commit. Only a durable server cancellation or confirmed result safely resolves
the request before a replacement reference is issued.

**Why:** An old HTTP request may reach the transaction after the recovery lookup.
Unlocking on a 404 can create two independent successful requests for one purchase.

**How to apply:** Keep exact retry payloads, fail closed if pending-state storage
fails, and retain cancellation markers under the same serialization rules as sales.

Guest order recovery keeps its private capability out of URLs and logs, and
returns no customer name, full phone or address.

**Why:** A copied tracking URL can leak through history, referrers or request logs.
Guest customers have no account protecting their order summary.

**How to apply:** Keep recovery tokens in tab storage and POST bodies; leave contact
details behind staff authorization. Automatic recovery must wait for the security
session and CSRF cookie/token rather than weakening CSRF checks to avoid a startup race.

Hostinger's MySQL-compatible engine rejects CHECK expressions involving foreign-key
columns with cascading updates.

**Why:** The POS migration encountered this engine restriction even though scalar
financial CHECK constraints worked. No data reset was needed.

**How to apply:** Keep foreign keys and scalar financial CHECKs; enforce related
actor/source invariants in the transactional service rather than incompatible CHECKs.
