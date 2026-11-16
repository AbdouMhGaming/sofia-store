import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, applyStockAdjustment } from "../src/index";

const rollback = new Error("ROLLBACK_VERIFICATION_FIXTURES");
let passed = false;
try {
  await db.$transaction(async tx => {
    const category = await tx.category.findFirstOrThrow();
    const location = await tx.location.findUniqueOrThrow({ where: { code: "STORE" } });
    const fixture = randomUUID();
    const actor = await tx.user.create({ data: { email: `${fixture}@invalid.test`, passwordHash: "not-a-login-hash", active: false } });
    const size = await tx.size.create({ data: { name: fixture.slice(0, 20) } });
    const color = await tx.color.create({ data: { name: fixture } });
    const product = await tx.product.create({ data: { slug: fixture, nameFr: "Test temporaire", nameAr: "", descriptionFr: "", descriptionAr: "", categoryId: category.id } });
    const variant = await tx.productVariant.create({ data: { productId: product.id, sizeId: size.id, colorId: color.id, sku: fixture, barcode: fixture, priceMinor: 123450, costMinor: 100000 } });
    const inventory = await tx.inventory.create({ data: { variantId: variant.id, locationId: location.id, onHand: 2, reserved: 1 } });
    const movement = { variantId: variant.id, quantity: 3, reason: "Vérification transactionnelle", kind: "RECEIPT", requestId: randomUUID() };
    await applyStockAdjustment(tx, movement, actor.id);
    await applyStockAdjustment(tx, movement, actor.id);
    assert.equal((await tx.inventory.findUniqueOrThrow({ where: { id: inventory.id } })).onHand, 5, "Retry must not apply twice");
    assert.equal(await tx.stockMovement.count({ where: { variantId: variant.id } }), 1);
    await assert.rejects(applyStockAdjustment(tx, { ...movement, quantity: 4 }, actor.id), /déjà été utilisée/);
    await assert.rejects(applyStockAdjustment(tx, { ...movement, quantity: -5, kind: "ADJUSTMENT", requestId: randomUUID() }, actor.id), /réservé/);
    await assert.rejects(applyStockAdjustment(tx, { ...movement, quantity: 1, kind: "DAMAGE", requestId: randomUUID() }, actor.id), /Signe/);
    await applyStockAdjustment(tx, { ...movement, quantity: -4, kind: "ADJUSTMENT", requestId: randomUUID() }, actor.id);
    assert.equal((await tx.inventory.findUniqueOrThrow({ where: { id: inventory.id } })).onHand, 1);
    assert.equal(await tx.auditLog.count({ where: { userId: actor.id } }), 2);
    passed = true;
    throw rollback;
  }, { maxWait: 5000, timeout: 60000 });
} catch (error) {
  if (error !== rollback) {
    console.error("Stock verification failed.", (error as { code?: string }).code || "ASSERTION_OR_DATABASE_ERROR");
    process.exitCode = 1;
  }
} finally {
  await db.$disconnect();
}
if (passed && !process.exitCode) {
  console.log("PASS: exact integer balances, repeat-request idempotency, conflicting-key rejection, reservation protection, movement signs, and audit entries. All test fixtures rolled back.");
}
