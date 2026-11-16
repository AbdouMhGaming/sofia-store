import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, catalogHeaders, csvCell, parseCatalogCsv, transferCatalog } from "../src/index";

const rollback = new Error("ROLLBACK_CATALOG_VERIFICATION");
const suffix = randomUUID();
const makeCsv = (slug: string, category: string, sku: string, barcode: string) =>
  catalogHeaders.join(",") + "\n" + [slug, "VÉRIFICATION CSV", "اختبار", "", "", category, "/products/dress-1.jpeg", sku, barcode, "V-SIZE", "V-COLOR", "203045", "100001"].map(csvCell).join(",");
try {
  assert.equal(csvCell('=HYPERLINK("x")').startsWith('"\'='), true, "Export must neutralize formulas");
  assert.equal(parseCatalogCsv("bad,headers\nx,y").errors.length > 0, true);
  const valid = makeCsv(`verification-${suffix}`, "robes-brodees", `SKU-${suffix}`, `BC-${suffix}`);
  assert.equal(parseCatalogCsv(valid).errors.length, 0);
  assert.equal(parseCatalogCsv(valid.replace('"203045"', '"2030.45"')).errors.length > 0, true, "Fractional centimes must fail");
  await db.$transaction(async tx => {
    const category = await tx.category.findFirstOrThrow();
    const actor = await tx.user.create({ data: { email: `${suffix}@invalid.test`, passwordHash: "not-a-login-hash", active: false } });
    const csv = makeCsv(`verification-${suffix}`, category.slug, `SKU-${suffix}`, `BC-${suffix}`);
    const input = { csv, dryRun: true, requestId: randomUUID() };
    const preview = await transferCatalog(tx, input, actor.id);
    assert.equal(preview.valid, true); assert.equal(preview.committed, false);
    assert.equal(await tx.product.count({ where: { slug: `verification-${suffix}` } }), 0, "Dry run must not write");
    const result = await transferCatalog(tx, { ...input, dryRun: false }, actor.id);
    assert.equal(result.committed, true);
    assert.equal((await transferCatalog(tx, { ...input, dryRun: false }, actor.id)).committed, true, "Retry returns committed result");
    assert.equal(await tx.product.count({ where: { slug: `verification-${suffix}` } }), 1);
    const variant = await tx.productVariant.findUniqueOrThrow({ where: { sku: `SKU-${suffix}` }, include: { inventory: true } });
    assert.equal(variant.priceMinor, 203045);
    assert.equal(variant.inventory[0]?.onHand, 0);
    await assert.rejects(transferCatalog(tx, { ...input, csv: csv + "\n", dryRun: false }, actor.id), /déjà été utilisée/);
    const conflicts = await transferCatalog(tx, { ...input, dryRun: false, requestId: randomUUID() }, actor.id);
    assert.equal(conflicts.valid, false); assert.equal(conflicts.committed, false);
    const badCsv = makeCsv(`verification-invalid-${suffix}`, "does-not-exist", `NEW-${suffix}`, `NEW-BC-${suffix}`);
    const bad = await transferCatalog(tx, { csv: badCsv, dryRun: false, requestId: randomUUID() }, actor.id);
    assert.equal(bad.valid, false);
    assert.equal(await tx.product.count({ where: { slug: `verification-invalid-${suffix}` } }), 0);
    assert.equal(await tx.auditLog.count({ where: { userId: actor.id, action: "CATALOG_IMPORTED" } }), 1);
    throw rollback;
  }, { timeout: 60000, maxWait: 5000 });
} catch (error) {
  if (error !== rollback) { console.error("Catalog verification failed.", (error as { code?: string }).code || (error as Error).message); process.exitCode = 1; }
} finally { await db.$disconnect(); }
if (!process.exitCode) console.log("PASS: CSV validation, exact centimes, dry-run safety, atomic new-product import, zero stock, duplicate retries, conflicting references, and audit. All fixtures rolled back.");
