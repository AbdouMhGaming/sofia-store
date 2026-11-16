import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  db, Prisma, posTransaction, openDrawer, closeDrawer, recordCashSale, recordRefund,
  cancelSaleAttempt, cancelRefundAttempt, cancelRegisterAttempt, saveReceiptSettings,
  allocateDiscount, refundAmount, drawerTotals, readSale, type PosActor,
} from "../src/index";
import type { CashSaleInput } from "@workspace/api-zod";

async function fixture(tx: Prisma.TransactionClient) {
  const suffix = randomUUID().slice(0, 8);
  const category = await tx.category.findFirstOrThrow();
  const manager = await tx.user.create({ data: { email: `pos-manager-${suffix}@invalid.test`, passwordHash: "NO_LOGIN_TEST_FIXTURE", active: false } });
  const cashier = await tx.user.create({ data: { email: `pos-cashier-${suffix}@invalid.test`, passwordHash: "NO_LOGIN_TEST_FIXTURE", active: false } });
  const register = await tx.cashRegister.create({ data: { code: `VERIFY-${suffix}`, name: `VÉRIFICATION ${suffix}` } });
  const product = await tx.product.create({ data: {
    slug: `verification-pos-${suffix}`, nameFr: `VÉRIFICATION — NE PAS VENDRE ${suffix}`, nameAr: "اختبار",
    categoryId: category.id, descriptionFr: "", descriptionAr: "", status: "ARCHIVED",
  } });
  const sizeA = await tx.size.create({ data: { name: `V-${suffix}-M` } }), sizeB = await tx.size.create({ data: { name: `V-${suffix}-L` } });
  const color = await tx.color.create({ data: { name: `V-${suffix}` } });
  const a = await tx.productVariant.create({ data: { productId: product.id, sizeId: sizeA.id, colorId: color.id, sku: `V-${suffix}-A`, barcode: `00VERIFY${suffix}A`, priceMinor: 10001, costMinor: 6000 } });
  const b = await tx.productVariant.create({ data: { productId: product.id, sizeId: sizeB.id, colorId: color.id, sku: `V-${suffix}-B`, barcode: `00VERIFY${suffix}B`, priceMinor: 20003, costMinor: 10000 } });
  const location = await tx.location.findUniqueOrThrow({ where: { code: "STORE" } });
  await tx.inventory.createMany({ data: [{ variantId: a.id, locationId: location.id, onHand: 20, reserved: 3 }, { variantId: b.id, locationId: location.id, onHand: 10, reserved: 2 }] });
  const owner: PosActor = { id: manager.id, role: "MANAGER", registerCode: register.code };
  const tiller: PosActor = { id: cashier.id, role: "CASHIER", registerCode: register.code };
  return { a, b, product, register, owner, tiller, manager, cashier, sizeA, sizeB, color };
}
function saleInput(sessionId: number, id: number, price: number, quantity = 1): CashSaleInput {
  return { requestId: randomUUID(), registerSessionId: sessionId, items: [{ variantId: id, quantity, expectedUnitPriceMinor: price, discountMinor: 0 }], orderDiscountMinor: 0, discountReason: "", tenderedMinor: 1000000 };
}
const rolledBack = new Error("ROLLBACK_POS_VERIFICATION");
let committed: Awaited<ReturnType<typeof fixture>> | undefined;
try {
  for (const [nets, discount] of [[[900000001, 99999999], 333333333], [[1, 1, 1], 2], [[0, 20, 30], 50]] as [number[], number][]) {
    const allocated = allocateDiscount(nets, discount);
    assert.equal(allocated.reduce((sum, n) => sum + n, 0), discount);
    allocated.forEach((n, i) => assert.ok(n >= 0 && n <= nets[i]!));
  }
  assert.deepEqual([0, 1, 2].map(q => refundAmount(30002, 3, q, 1)), [10000, 10001, 10001]);
  try {
    await db.$transaction(async tx => {
      const f = await fixture(tx);
      await tx.product.update({ where: { id: f.product.id }, data: { status: "ACTIVE" } });
      await saveReceiptSettings(tx, { address: "ADRESSE DE VÉRIFICATION", phone: "", footer: "TEST" }, f.owner);
      const opening = { openingMinor: 50000, requestId: randomUUID() };
      const session = await openDrawer(tx, opening, f.tiller);
      assert.equal((await openDrawer(tx, opening, f.tiller)).id, session.id);
      await assert.rejects(openDrawer(tx, { ...opening, openingMinor: 0 }, f.tiller), /référence/);
      await assert.rejects(openDrawer(tx, { openingMinor: 0, requestId: randomUUID() }, f.owner), /déjà ouverte/);
      const input = saleInput(session.id, f.a.id, f.a.priceMinor, 2);
      input.tenderedMinor = 30000;
      const sale = await recordCashSale(tx, input, f.tiller);
      assert.equal(sale.totalMinor, 20002); assert.equal(sale.changeMinor, 9998);
      assert.equal((await recordCashSale(tx, input, f.tiller)).id, sale.id);
      assert.equal(await tx.payment.count({ where: { saleId: sale.id } }), 1);
      assert.equal(await tx.stockMovement.count({ where: { saleItemId: sale.items[0]!.id } }), 1);
      const stock = await tx.inventory.findFirstOrThrow({ where: { variantId: f.a.id } });
      assert.equal(stock.onHand, 18); assert.equal(stock.reserved, 3);
      await assert.rejects(recordCashSale(tx, { ...input, tenderedMinor: 40000 }, f.tiller), /référence/);
      await assert.rejects(recordCashSale(tx, saleInput(session.id, f.a.id, 1), f.tiller), /prix/);
      await assert.rejects(recordCashSale(tx, { ...saleInput(session.id, f.a.id, f.a.priceMinor), tenderedMinor: 0 }, f.tiller), /insuffisantes/);
      await assert.rejects(recordCashSale(tx, { ...saleInput(session.id, f.a.id, f.a.priceMinor), orderDiscountMinor: 1, discountReason: "test" }, f.tiller), /responsable/);
      await assert.rejects(recordCashSale(tx, saleInput(session.id, f.a.id, f.a.priceMinor), f.owner), /titulaire/);
      const bad = saleInput(session.id, f.a.id, f.a.priceMinor);
      bad.items.push({ variantId: f.b.id, quantity: 999, expectedUnitPriceMinor: f.b.priceMinor, discountMinor: 0 });
      await assert.rejects(recordCashSale(tx, bad, f.tiller), /Stock disponible/);
      assert.equal(await tx.sale.count({ where: { userId: f.tiller.id } }), 1);
      assert.equal((await tx.inventory.findUniqueOrThrow({ where: { id: stock.id } })).onHand, 18);
      await assert.rejects(recordCashSale(tx, saleInput(session.id, f.a.id, f.a.priceMinor, 16), f.tiller), /Stock disponible/);
      await assert.rejects(saveReceiptSettings(tx, { address: "", phone: "", footer: "" }, f.tiller), /gestion/);
      const close = { countedMinor: 70002, reason: "Vérification du comptage", requestId: randomUUID() };
      const closed = await closeDrawer(tx, session.id, close, f.tiller);
      assert.equal(closed.expectedMinor, 70002); assert.equal(closed.varianceMinor, 0);
      assert.equal((await closeDrawer(tx, session.id, close, f.tiller)).id, session.id);
      await assert.rejects(closeDrawer(tx, session.id, { ...close, countedMinor: 1 }, f.tiller), /référence/);
      await assert.rejects(recordCashSale(tx, saleInput(session.id, f.a.id, f.a.priceMinor), f.tiller), /plus active/);
      const second = await openDrawer(tx, { openingMinor: 100000, requestId: randomUUID() }, f.owner);
      const discountedInput = saleInput(second.id, f.a.id, f.a.priceMinor, 3);
      discountedInput.orderDiscountMinor = 1; discountedInput.discountReason = "Vérification remise";
      const discounted = await recordCashSale(tx, discountedInput, f.owner);
      assert.equal(discounted.totalMinor, 30002); assert.equal(discounted.items[0]!.discountMinor, 1);
      const item = discounted.items[0]!;
      const refund = { requestId: randomUUID(), registerSessionId: second.id, kind: "RETURN" as const, reason: "Retour de vérification", items: [{ saleItemId: item.id, quantity: 1, restock: true }] };
      await assert.rejects(recordRefund(tx, discounted.id, refund, f.tiller), /responsable/);
      const partial = await recordRefund(tx, discounted.id, refund, f.owner);
      assert.equal(partial.refundedMinor, 10000); assert.equal(partial.status, "PARTIALLY_REFUNDED");
      await assert.rejects(recordRefund(tx, discounted.id, { ...refund, requestId: randomUUID(), items: [{ saleItemId: item.id, quantity: 3, restock: true }] }, f.owner), /quantité/);
      const damaged = await recordRefund(tx, discounted.id, { ...refund, requestId: randomUUID(), items: [{ saleItemId: item.id, quantity: 1, restock: false }] }, f.owner);
      assert.equal(damaged.refundedMinor, 20001);
      const final = await recordRefund(tx, discounted.id, { ...refund, requestId: randomUUID() }, f.owner);
      assert.equal(final.refundedMinor, 30002); assert.equal(final.status, "REFUNDED");
      assert.equal((await recordRefund(tx, discounted.id, refund, f.owner)).refundedMinor, 30002, "Retry must not refund twice");
      assert.equal((await tx.inventory.findUniqueOrThrow({ where: { id: stock.id } })).onHand, 17, "Damaged return does not restock");
      await assert.rejects(recordRefund(tx, sale.id, { ...refund, requestId: randomUUID(), kind: "VOID", items: sale.items.map(i => ({ saleItemId: i.id, quantity: i.quantity, restock: true })) }, f.owner), /annulation/);
      await recordRefund(tx, sale.id, { ...refund, requestId: randomUUID(), items: sale.items.map(i => ({ saleItemId: i.id, quantity: i.quantity, restock: true })) }, f.owner);
      assert.equal((await drawerTotals(tx, session.id, session.openingMinor)).expectedMinor, 70002, "Refund of old receipt uses current drawer");
      const voidable = await recordCashSale(tx, saleInput(second.id, f.b.id, f.b.priceMinor), f.owner);
      const voidInput = { requestId: randomUUID(), registerSessionId: second.id, kind: "VOID" as const, reason: "Annulation de vérification", items: voidable.items.map(i => ({ saleItemId: i.id, quantity: i.quantity, restock: true })) };
      assert.equal((await recordRefund(tx, voidable.id, voidInput, f.owner)).status, "VOIDED");
      assert.equal((await recordRefund(tx, voidable.id, voidInput, f.owner)).refunds.length, 1);
      assert.equal((await cancelRefundAttempt(tx, { requestId: voidInput.requestId, registerSessionId: second.id, saleId: voidable.id }, f.owner)).cancelled, false);
      const cancelledInput = saleInput(second.id, f.b.id, f.b.priceMinor);
      assert.equal((await cancelSaleAttempt(tx, cancelledInput, f.owner)).cancelled, true);
      await assert.rejects(recordCashSale(tx, cancelledInput, f.owner), /abandonnée/);
      assert.equal((await cancelSaleAttempt(tx, discountedInput, f.owner)).sale?.id, discounted.id);
      const cancelledRefund = { ...refund, requestId: randomUUID() };
      await cancelRefundAttempt(tx, { ...cancelledRefund, saleId: sale.id }, f.owner);
      await assert.rejects(recordRefund(tx, sale.id, cancelledRefund, f.owner), /abandonnée/);
      const cancelledClose = { countedMinor: 79998, reason: "Vérification", requestId: randomUUID() };
      await cancelRegisterAttempt(tx, { requestId: cancelledClose.requestId, kind: "CLOSE", registerSessionId: second.id }, f.owner);
      await assert.rejects(closeDrawer(tx, second.id, cancelledClose, f.owner), /abandonnée/);
      const counted = await closeDrawer(tx, second.id, { ...cancelledClose, requestId: randomUUID(), countedMinor: 79900 }, f.owner);
      assert.equal(counted.expectedMinor, 79998); assert.equal(counted.varianceMinor, -98);
      const cancelOpening = { openingMinor: 0, requestId: randomUUID() };
      await cancelRegisterAttempt(tx, { requestId: cancelOpening.requestId, kind: "OPEN", registerSessionId: null }, f.owner);
      await assert.rejects(openDrawer(tx, cancelOpening, f.owner), /abandonnée/);
      await tx.productVariant.update({ where: { id: f.a.id }, data: { priceMinor: 99000, costMinor: 1 } });
      await tx.product.update({ where: { id: f.product.id }, data: { nameFr: "NOUVEAU NOM DE VÉRIFICATION" } });
      await saveReceiptSettings(tx, { address: "AUTRE ADRESSE DE TEST", phone: "", footer: "" }, f.owner);
      const historical = await readSale(tx, sale.id);
      assert.equal(historical.items[0]!.unitPriceMinor, 10001);
      assert.equal(historical.receiptSettings.address, "ADRESSE DE VÉRIFICATION");
      assert.ok(historical.items[0]!.productName.includes("VÉRIFICATION"));
      assert.equal((await tx.saleItem.findUniqueOrThrow({ where: { id: sale.items[0]!.id } })).unitCostMinor, 6000);
      throw rolledBack;
    }, { timeout: 240000, maxWait: 10000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  } catch (error) { if (error !== rolledBack) throw error; }
  console.log("PASS: atomic cash sales, authoritative prices, stock/reservations, exact discounts, payments/change, register reconciliation, immutable snapshots, partial/damaged returns, voids and durable cancellation. Sequential fixtures rolled back.");
  committed = await posTransaction(tx => fixture(tx));
  const f = committed;
  const session = await posTransaction(tx => openDrawer(tx, { openingMinor: 100000, requestId: randomUUID() }, f.owner));
  await db.inventory.updateMany({ where: { variantId: f.a.id }, data: { onHand: 1, reserved: 0 } });
  const run = (input: CashSaleInput) => posTransaction(async tx => {
    await tx.product.update({ where: { id: f.product.id }, data: { status: "ACTIVE" } });
    const result = await recordCashSale(tx, input, f.owner);
    await tx.product.update({ where: { id: f.product.id }, data: { status: "ARCHIVED" } });
    return result;
  });
  const last = await Promise.allSettled([run(saleInput(session.id, f.a.id, f.a.priceMinor)), run(saleInput(session.id, f.a.id, f.a.priceMinor))]);
  assert.equal(last.filter(r => r.status === "fulfilled").length, 1, "Only one concurrent purchase can buy the last unit");
  assert.equal((await db.inventory.findFirstOrThrow({ where: { variantId: f.a.id } })).onHand, 0);
  await db.inventory.updateMany({ where: { variantId: f.a.id }, data: { onHand: 3 } });
  const same = saleInput(session.id, f.a.id, f.a.priceMinor);
  const retries = await Promise.all([run(same), run(same)]);
  assert.equal(retries[0].id, retries[1].id);
  assert.equal((await db.inventory.findFirstOrThrow({ where: { variantId: f.a.id } })).onHand, 2);
  const late = saleInput(session.id, f.a.id, f.a.priceMinor);
  await posTransaction(tx => cancelSaleAttempt(tx, late, f.owner));
  await assert.rejects(run(late), /abandonnée/);
  const racing = saleInput(session.id, f.a.id, f.a.priceMinor);
  const [purchase, cancellation] = await Promise.allSettled([run(racing), posTransaction(tx => cancelSaleAttempt(tx, racing, f.owner))]);
  assert.equal(cancellation.status, "fulfilled");
  if (cancellation.status === "fulfilled") {
    if (purchase.status === "fulfilled") { assert.equal(cancellation.value.cancelled, false); assert.equal(cancellation.value.sale?.id, purchase.value.id); }
    else assert.equal(cancellation.value.cancelled, true);
  }
  console.log("PASS: competing last-unit sales, simultaneous same-key retries, late requests after cancellation, and purchase-versus-cancellation races.");
} catch (error) {
  console.error("POS verification failed:", (error as { code?: string }).code || (error as Error).name,
    (error as Error).name === "AssertionError" ? (error as Error).message : (error as { status?: number }).status ? (error as Error).message : "");
  process.exitCode = 1;
} finally {
  if (committed) {
    const f = committed, users = [f.manager.id, f.cashier.id];
    try {
      await posTransaction(async tx => {
        const sales = await tx.sale.findMany({ where: { userId: { in: users } }, select: { id: true } });
        const ids = sales.map(s => s.id);
        await tx.stockMovement.deleteMany({ where: { userId: { in: users } } });
        await tx.refundItem.deleteMany({ where: { refund: { saleId: { in: ids } } } });
        await tx.refund.deleteMany({ where: { saleId: { in: ids } } });
        await tx.payment.deleteMany({ where: { saleId: { in: ids } } });
        await tx.saleItem.deleteMany({ where: { saleId: { in: ids } } });
        await tx.sale.deleteMany({ where: { id: { in: ids } } });
        await tx.cashRegister.update({ where: { id: f.register.id }, data: { currentSessionId: null } });
        await tx.posCancellation.deleteMany({ where: { registerId: f.register.id } });
        await tx.registerSession.deleteMany({ where: { registerId: f.register.id } });
        await tx.cashRegister.delete({ where: { id: f.register.id } });
        await tx.inventory.deleteMany({ where: { variantId: { in: [f.a.id, f.b.id] } } });
        await tx.productVariant.deleteMany({ where: { productId: f.product.id } });
        await tx.product.delete({ where: { id: f.product.id } });
        await tx.size.deleteMany({ where: { id: { in: [f.sizeA.id, f.sizeB.id] } } });
        await tx.color.delete({ where: { id: f.color.id } });
        await tx.auditLog.deleteMany({ where: { userId: { in: users } } });
        await tx.user.deleteMany({ where: { id: { in: users } } });
      });
      console.log("Only verification-owned concurrent-test records were removed.");
    } catch (error) { console.error("POS fixture cleanup needs attention:", (error as { code?: string }).code || "CLEANUP_FAILED"); process.exitCode = 1; }
  }
  await db.$disconnect();
}
