# Phase 3 — catalog, barcodes, and inventory

Current phase: **Phase 3**. Next phase: **Phase 4 — POS, barcode input, cash sales,
and printable receipts**. Do not call Phase 3 complete while durable image upload
cannot be verified.

## Catalog management

- `/admin/categories`: create/edit French and Arabic names plus category slug.
  Deletion is restricted to empty categories, including archived products.
- `/admin/produits`: create/edit/archive/restore products; choose, reorder, replace,
  and remove images. First image is the main photo.
- `/admin/inventaire`: edit SKU, barcode, size, color, selling price, and cost without
  changing stock. Variant changes are audited. Prices use exact integer centimes.
- New variant stock starts at zero. Existing stock changes only through the
  attributed movement workflow. Available = on-hand − reserved.
- Low-stock filter uses available stock at or below three units.
- Barcode label generation uses the variant's actual barcode (Code128). Browser
  printing is offered; compatibility with the physical label printer is not claimed.
- `/admin/mouvements`: cursor-paginated detailed movements, filterable by variant,
  with actor, reason, signed quantity, timestamp, and balance after the movement.

## CSV import/export

Page: `/admin/import-export`. Header-only template:

```
productSlug,nameFr,nameAr,descriptionFr,descriptionAr,categorySlug,imagePath,sku,barcode,size,color,priceMinor,costMinor
```

Rules:

- UTF-8 CSV with commas, standard quoted fields, optional UTF-8 BOM.
- Maximum 200,000 characters and 100 variant rows per import.
- `priceMinor` is a positive integer in centimes, `costMinor` a nonnegative integer.
  For example, 203045 centimes displays as 2030,45 DA. No float conversion.
- Product slug, both names, category slug, SKU, barcode, size, color, price, and cost
  are required; descriptions and image path may be blank.
- The category must already exist.
- New products only. Existing product slugs, SKUs, or barcodes are never overwritten.
- Multiple rows may describe different variants of one new product, but product
  metadata must match on every such row.
- All imports create PREVIEW products and zero-stock variants. An import is not a
  stock reception and cannot alter reserved or on-hand quantities.
- Analyze first. Analysis does not write business data. Editing text invalidates the
  analysis and commit confirmation. Commit requires explicit confirmation.
- Commit is one transaction. Any database conflict rolls the entire import back.
- Repeating the same commit reference and file returns the original result, without
  creating duplicates. A reference cannot be reused for a different file or user.
- Imports are attributed in the audit log.
- Export includes all product variants and unpriced preview rows, with price/cost
  in centimes. It is not a Safe-POS migration format.
- Spreadsheet formula-like fields are prefixed with an apostrophe on export. Quoting
  alone is insufficient to prevent spreadsheet formula execution.
- Exports beyond 10,000 products fail explicitly rather than silently truncate.

## Product photographs

The packaged official logo, banner, and six supplied photos remain available.
New-photo workflow is implemented at `/admin/medias`:

1. Authenticated, CSRF-protected upload ticket with metadata only.
2. Browser sends bytes directly to the signed storage URL, not to the API filesystem.
3. Server validates actual size and decodes the uploaded file.
4. Only non-animated JPEG/PNG/WebP photos up to 8 MiB and 20 million pixels pass.
5. Re-encode to WebP, remove embedded metadata, fit inside 1600×2400 without cropping,
   and generate a 400×600 thumbnail.
6. Store paths, attribution, dimensions, status, and byte count in MySQL. File bytes
   stay in persistent object storage, never in MySQL or the temporary project disk.
7. Product images reference validated assets. Attachment and deletion lock asset
   rows so an image cannot be attached concurrently with removal.
8. Only photos used by a visible product are publicly served; unattached photos need
   authorized staff access. Raw uploads are never served to customers.
9. Removing a used image from the media library is refused. Remove it from products
   first. Library deletion revokes serving access and preserves storage objects for
   recovery; physical garbage collection/retention remains an operations task.

### Hostinger storage requirement

The owner intends to host everything on Hostinger. Creating a Replit App Storage
bucket is **not required**, and its failed provisioning is not a user setup task.

The current, disabled upload adapter uses Replit's storage sidecar. Its image
validation/optimization can be reused, but the storage and upload transport must be
adapted to Hostinger. Until that is implemented and verified, upload controls correctly
show storage unavailable and no successful upload is claimed.

Hostinger's managed Node.js deployments replace files under both `hbuilds/` and
`public_html`; do not put durable customer-uploaded photographs there. The intended
Hostinger-only approach is a configurable persistent uploads directory outside
deployment-managed directories, **subject to verifying this plan's filesystem access
and permissions**. The exact managed-hosting versus VPS plan determines setup.

Source: https://docs.hostinger.com/node.js/file-structure

Before closing the upload gate, verify write access, a real upload, optimized
thumbnail, image ordering/replacement/removal, access control, refusal to delete an
attached photo, and survival across restart and redeployment. Back up the upload
directory together with MySQL metadata. Do not substitute temporary Replit disk for
production-persistent storage.

## Verification commands

```
pnpm run typecheck
pnpm --filter @workspace/db run validate
pnpm --filter @workspace/scripts exec tsx ../lib/db/tools/verify-catalog-transfer.ts
pnpm --filter @workspace/scripts exec tsx ../artifacts/api-server/tools/verify-media.ts
```

The catalog checks use the actual service and development MySQL inside a transaction,
then roll back all verification records. They cover header/numeric validation,
dry-run safety, atomic import, zero opening stock, repeat retries, conflict rejection,
and audit attribution. The image check verifies local validation and optimization,
not successful cloud storage.

A signed-in browser check with a temporary manager also passed category creation,
CSV analysis/confirmation/commit, exact-price persistence after reload, zero-stock
preservation, empty movement history after import, and matching Code128 label rendering.
It confirmed the truthful storage-unavailable warning. Category refresh and import
success wording were subsequently improved and type-checked. The temporary account
was disabled, its sessions revoked, and its zero-stock verification products removed;
the audit trail was retained. No real owner password or retail stock was used.
