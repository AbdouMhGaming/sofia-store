---
name: Retail scope and hosting
description: Owner-confirmed hosting facts and retail launch constraints not inferable from code.
---

The owner confirmed the supplied Hostinger MySQL database is a development database
and their Hostinger plan supports Node.js.

**Why:** The project brief requires these checks before development and forbids
substitution with a temporary or unrelated database.

**How to apply:** Keep development and production separate. Before a real deployment,
confirm the exact production database, hosting startup configuration, and persistent
image storage. Node.js support is owner-confirmed, not verified by access to their account.

The owner intends to host everything on Hostinger. A Replit App Storage bucket is
not a required part of the hosting plan. The owner selected Business or Cloud hosting,
not VPS; the exact tier has not been specified.

**Why:** The owner corrected the unnecessary requirement to create a Replit bucket
when their intended hosting is entirely on Hostinger.

**How to apply:** Choose a Hostinger-compatible persistent upload setup. Do not make
a Replit storage bucket a prerequisite. Verify writable storage and persistence
across Hostinger redeployments before claiming uploads are production-ready.

This platform must eventually replace the store's Safe-POS installation, not merely
provide a fashion storefront. It must use the real supplied logo, banner, and clothing
photographs; the owner did not provide verified product prices, sizes, or stock.

**Why:** These are explicit commercial requirements; invented retail data could be
mistaken for actual offers or stock.

**How to apply:** Treat photo-derived labels as provisional previews until verified.
Never claim launch readiness until concurrent stock operations, cash sales, order
reservations, backup restoration, and the store's actual scanner/printer are tested.

Always tell the user which phase we are in and which phase is next until everything
in this project is finished.

**Why:** The user explicitly requested phase-by-phase status in every continuation.

**How to apply:** Include current and next phase in progress summaries and final
responses. Do not call a phase complete while its required functionality or critical
checks remain open.

The owner requested delivery fees for all 58 wilayas in settings, separated into
home and desk delivery, with delivery times. Unconfirmed-order reservation duration
must also be a setting rather than a fixed answer collected in chat.

**Why:** The owner explicitly asked to manage these values in the app instead of
providing fixed fees or a reservation policy during development.

**How to apply:** Preserve owner-editable business configuration. Never substitute
invented fees, delivery times or hold duration when a value has not been entered.
