import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { db, Prisma, posTransaction, disabledCheckout, saveCheckoutSettings, lockCheckout, buildCheckoutQuote, placeWebOrder,
  actOnWebOrder, recordWebPayment, cancelWebOrder, expireCheckoutOrders, recoverWebCommand, abandonWebCommand,
  openDrawer, closeDrawer, drawerTotals, recordCashSale, type PosActor } from "../src/index";
import type { WebOrderAction, WebOrderOperation, WebOrderPaymentInput, AdminCheckoutOrder } from "@workspace/api-zod";

const uuid = () => randomUUID(), rollback = new Error("ROLLBACK_FULFILLMENT_VERIFICATION");
async function fixture(tx: Prisma.TransactionClient) {
  const suffix = uuid().slice(0, 8);
  const user = await tx.user.create({ data: { email: `fulfillment-${suffix}@invalid.test`, passwordHash: "DISABLED_VERIFICATION_ACCOUNT", active: true, mustChangePassword: false, roles: { create: { role: { connect: { name: "STORE_OWNER" } } } } } });
  const actor: PosActor = { id: user.id, role: "STORE_OWNER", registerCode: `V-FUL-${suffix}`, authVersion: user.version };
  const register = await tx.cashRegister.create({ data: { code: actor.registerCode!, name: `VÉRIFICATION ${suffix}` } });
  const category = await tx.category.findFirstOrThrow();
  const size = await tx.size.create({ data: { name: `VF-${suffix}` } }), color = await tx.color.create({ data: { name: `VF-${suffix}` } });
  const product = await tx.product.create({ data: { slug: `verify-fulfillment-${suffix}`, nameFr: `VÉRIFICATION EXPÉDITION ${suffix}`, nameAr: "اختبار", descriptionFr: "", descriptionAr: "", categoryId: category.id, status: "ACTIVE" } });
  const variant = await tx.productVariant.create({ data: { productId: product.id, sizeId: size.id, colorId: color.id, sku: `VF-${suffix}`, barcode: `00VF${suffix}`, priceMinor: 10001, costMinor: 5000 } });
  const location = await tx.location.findUniqueOrThrow({ where: { code: "STORE" } });
  const inventory = await tx.inventory.create({ data: { variantId: variant.id, locationId: location.id, onHand: 40, reserved: 0 } });
  return { user, actor, register, product, size, color, variant, inventory };
}
function settings() {
  const c = disabledCheckout();
  c.enabled = c.pickupEnabled = c.deliveryEnabled = true; c.reservationMinutes = 60; c.pickupFeeMinor = 200;
  c.policyFr = "Conditions temporaires de vérification, pas des offres commerciales.";
  c.policyAr = "شروط اختبار مؤقتة، ليست عروضاً تجارية.";
  Object.assign(c.zones[47]!, { enabled: true, homeFeeMinor: 50000, homeMinDays: 2, homeMaxDays: 4 });
  return c;
}
async function rejected(tx: Prisma.TransactionClient, work: () => Promise<unknown>, status = 409) {
  await tx.$executeRawUnsafe("SAVEPOINT verify_web_operation");
  let error: unknown;
  try { await work(); } catch (e) { error = e; }
  await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT verify_web_operation");
  await tx.$executeRawUnsafe("RELEASE SAVEPOINT verify_web_operation");
  assert.ok(error, "Expected operation to fail");
  assert.equal((error as { status?: number }).status, status);
}
async function order(tx: Prisma.TransactionClient, f: Awaited<ReturnType<typeof fixture>>, pickup: boolean, quantity = 2) {
  const cart = { items: [{ variantId: f.variant.id, quantity }], fulfillment: pickup ? "PICKUP" as const : "DELIVERY" as const,
    zoneCode: pickup ? null : "48", deliveryMode: pickup ? null : "HOME" as const };
  const quote = await buildCheckoutQuote(tx, cart);
  const result = await placeWebOrder(tx, { ...cart, requestId: uuid(), accessToken: randomBytes(32).toString("hex"),
    expectedQuoteHash: quote.quoteHash, customerName: "Vérification uniquement", customerPhone: "0550000000",
    commune: pickup ? "" : "Oued Rhiou", address: pickup ? "" : "Adresse de vérification uniquement", notes: "", acceptedPolicy: true });
  return (await tx.webOrder.findUniqueOrThrow({ where: { requestId: result.requestId } })).id;
}
const action = (status: WebOrderAction["expectedStatus"], operation: WebOrderOperation, extra: Partial<WebOrderAction> = {}): WebOrderAction => ({
  requestId: uuid(), expectedStatus: status, action: operation, reason: "Vérification développement uniquement",
  collector: null, carrierName: "", trackingNumber: "", restockVariantIds: null, ...extra,
});
async function ready(tx: Prisma.TransactionClient, id: number, actor: PosActor, collector: "STAFF" | "COURIER") {
  await actOnWebOrder(tx, id, action("PENDING", "CONFIRM", { collector }), actor);
  await actOnWebOrder(tx, id, action("CONFIRMED", "PREPARE"), actor);
  return actOnWebOrder(tx, id, action("PREPARING", "READY"), actor);
}
async function deliver(tx: Prisma.TransactionClient, id: number, actor: PosActor, collector: "STAFF" | "COURIER") {
  await ready(tx, id, actor, collector);
  await actOnWebOrder(tx, id, action("READY", "DISPATCH", { carrierName: collector === "COURIER" ? "Transporteur de vérification" : "", trackingNumber: collector === "COURIER" ? "SUIVI-TEST" : "" }), actor);
  return actOnWebOrder(tx, id, action("DISPATCHED", "DELIVER"), actor);
}
const payment = (row: AdminCheckoutOrder, sessionId: number, extra: Partial<WebOrderPaymentInput> = {}): WebOrderPaymentInput => ({
  requestId: uuid(), expectedStatus: row.status, kind: "RECEIPT", method: "CASH", amountMinor: row.totalMinor,
  feeMinor: 0, feeRefundMinor: 0, tenderedMinor: 100000, registerSessionId: sessionId, reference: "", reason: "Vérification développement uniquement", ...extra,
});
let committed: Awaited<ReturnType<typeof fixture>> | undefined;
try {
  if (process.env.NODE_ENV === "production") throw new Error("Development verification only");
  try {
    await db.$transaction(async tx => {
      const f = await fixture(tx);
      await saveCheckoutSettings(tx, settings(), f.actor);
      const session = await openDrawer(tx, { requestId: uuid(), openingMinor: 100000 }, f.actor);
      const cancellable = await order(tx, f, true);
      await rejected(tx, () => actOnWebOrder(tx, cancellable, action("PENDING", "CONFIRM", { collector: "COURIER" }), f.actor), 400);
      await rejected(tx, () => actOnWebOrder(tx, cancellable, action("PENDING", "CONFIRM", { collector: "STAFF" }), { ...f.actor, role: "CASHIER" }), 403);
      const confirm = action("PENDING", "CONFIRM", { collector: "STAFF" });
      await actOnWebOrder(tx, cancellable, confirm, f.actor);
      await actOnWebOrder(tx, cancellable, confirm, f.actor);
      assert.equal(await tx.webOrderEvent.count({ where: { orderId: cancellable, kind: "CONFIRM" } }), 1);
      await rejected(tx, () => actOnWebOrder(tx, cancellable, { ...confirm, reason: "changed operation" }, f.actor));
      await tx.webOrder.update({ where: { id: cancellable }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await expireCheckoutOrders(tx);
      assert.equal((await tx.webOrder.findUniqueOrThrow({ where: { id: cancellable } })).status, "CONFIRMED", "Confirmed reservations do not expire");
      await cancelWebOrder(tx, cancellable, "Annulation de vérification", f.actor);
      assert.equal((await tx.inventory.findUniqueOrThrow({ where: { id: f.inventory.id } })).reserved, 0);
      const stale = await order(tx, f, true);
      await tx.webOrder.update({ where: { id: stale }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await rejected(tx, () => actOnWebOrder(tx, stale, action("PENDING", "CONFIRM", { collector: "STAFF" }), f.actor));
      await expireCheckoutOrders(tx);

      const pickupId = await order(tx, f, true);
      const pickup = await ready(tx, pickupId, f.actor, "STAFF");
      await rejected(tx, () => actOnWebOrder(tx, pickupId, action("READY", "DISPATCH"), f.actor));
      const body = payment(pickup, session.id, { tenderedMinor: 30000 });
      const paid = await recordWebPayment(tx, pickupId, body, f.actor);
      assert.equal(paid.status, "COMPLETED"); assert.equal(paid.paymentStatus, "PAID");
      assert.equal(paid.payments[0]!.changeMinor, 9798); assert.equal(paid.storeReceivedMinor, 20202);
      const stockPaid = await tx.inventory.findUniqueOrThrow({ where: { id: f.inventory.id } });
      assert.equal(stockPaid.onHand, 38); assert.equal(stockPaid.reserved, 0);
      await recordWebPayment(tx, pickupId, body, f.actor);
      assert.equal(await tx.webOrderPayment.count({ where: { orderId: pickupId } }), 1);
      assert.equal((await recoverWebCommand(tx, pickupId, body.requestId, f.actor)).state, "COMPLETED");
      assert.equal((await abandonWebCommand(tx, pickupId, body.requestId, f.actor)).state, "COMPLETED");
      await rejected(tx, () => cancelWebOrder(tx, pickupId, "Already handed over", f.actor));
      await actOnWebOrder(tx, pickupId, action("COMPLETED", "RETURN_START"), f.actor);
      const returned = await actOnWebOrder(tx, pickupId, action("RETURNING", "RETURN_RECEIVE", { restockVariantIds: [f.variant.id] }), f.actor);
      const refund = payment(returned, session.id, { kind: "REFUND", amountMinor: 20202, feeRefundMinor: 200, tenderedMinor: null });
      await recordWebPayment(tx, pickupId, refund, f.actor);
      await recordWebPayment(tx, pickupId, refund, f.actor);
      assert.equal((await tx.inventory.findUniqueOrThrow({ where: { id: f.inventory.id } })).onHand, 40);
      assert.equal((await drawerTotals(tx, session.id, 100000)).expectedMinor, 100000);
      await rejected(tx, () => recordWebPayment(tx, pickupId, { ...refund, requestId: uuid() }, f.actor));

      const courierId = await order(tx, f, false);
      let courier = await deliver(tx, courierId, f.actor, "COURIER");
      assert.equal(courier.paymentStatus, "UNPAID"); assert.equal(courier.storeReceivedMinor, 0);
      await rejected(tx, () => recordWebPayment(tx, courierId, payment(courier, session.id), f.actor));
      courier = await actOnWebOrder(tx, courierId, action("DELIVERED", "COURIER_COLLECT"), f.actor);
      assert.equal(courier.paymentStatus, "COLLECTED_BY_COURIER"); assert.equal(courier.courierOutstandingMinor, 70002);
      const bank = payment(courier, session.id, { method: "BANK", amountMinor: 60002, feeMinor: 10000, tenderedMinor: null, registerSessionId: null, reference: "VIREMENT-VERIFICATION" });
      await rejected(tx, () => recordWebPayment(tx, courierId, { ...bank, amountMinor: 60001 }, f.actor));
      courier = await recordWebPayment(tx, courierId, bank, f.actor);
      assert.equal(courier.storeReceivedMinor, 60002); assert.equal(courier.carrierFeesMinor, 10000);
      assert.equal(courier.courierOutstandingMinor, 0); assert.equal(courier.status, "COMPLETED");
      assert.equal((await drawerTotals(tx, session.id, 100000)).expectedMinor, 100000, "BANK never changes cash");
      await actOnWebOrder(tx, courierId, action("COMPLETED", "RETURN_START"), f.actor);
      courier = await actOnWebOrder(tx, courierId, action("RETURNING", "RETURN_RECEIVE", { restockVariantIds: [] }), f.actor);
      assert.equal((await tx.inventory.findUniqueOrThrow({ where: { id: f.inventory.id } })).onHand, 38, "Damaged returns are not sellable stock");
      courier = await recordWebPayment(tx, courierId, payment(courier, session.id, {
        kind: "REFUND", method: "BANK", amountMinor: 30002, feeRefundMinor: 10000, tenderedMinor: null, registerSessionId: null, reference: "REMBOURSEMENT-VERIFICATION",
      }), f.actor);
      assert.equal(courier.paymentStatus, "REFUNDED"); assert.equal(courier.refundedMinor, 30002);

      const owingId = await order(tx, f, false);
      await deliver(tx, owingId, f.actor, "COURIER");
      await actOnWebOrder(tx, owingId, action("DELIVERED", "COURIER_COLLECT"), f.actor);
      await actOnWebOrder(tx, owingId, action("DELIVERED", "RETURN_START"), f.actor);
      let owing = await actOnWebOrder(tx, owingId, action("RETURNING", "RETURN_RECEIVE", { restockVariantIds: [f.variant.id] }), f.actor);
      owing = await recordWebPayment(tx, owingId, payment(owing, session.id, { kind: "REFUND", amountMinor: 20002, tenderedMinor: null }), f.actor);
      assert.equal(owing.courierOutstandingMinor, 70002, "Shop refund does not erase money the courier still holds");
      owing = await recordWebPayment(tx, owingId, payment(owing, session.id, { amountMinor: 65002, feeMinor: 5000 }), f.actor);
      assert.equal(owing.status, "RETURNED"); assert.equal(owing.paymentStatus, "REFUNDED"); assert.equal(owing.courierOutstandingMinor, 0);
      assert.equal((await drawerTotals(tx, session.id, 100000)).expectedMinor, 145000);

      const staffId = await order(tx, f, false, 1);
      const staff = await deliver(tx, staffId, f.actor, "STAFF");
      const abandoned = payment(staff, session.id);
      await abandonWebCommand(tx, staffId, abandoned.requestId, f.actor);
      await rejected(tx, () => recordWebPayment(tx, staffId, abandoned, f.actor));
      await rejected(tx, () => recoverWebCommand(tx, staffId, abandoned.requestId, { ...f.actor, id: f.user.id + 100000 }), 404);
      await recordWebPayment(tx, staffId, payment(staff, session.id, { tenderedMinor: 61000 }), f.actor);
      await recordCashSale(tx, { requestId: uuid(), registerSessionId: session.id, items: [{ variantId: f.variant.id, quantity: 1, expectedUnitPriceMinor: 10001, discountMinor: 0 }],
        orderDiscountMinor: 0, discountReason: "", tenderedMinor: 20000 }, f.actor);
      const totals = await drawerTotals(tx, session.id, 100000);
      assert.equal(totals.salesMinor, 10001); assert.equal(totals.webReceiptsMinor, 145205); assert.equal(totals.webRefundsMinor, 40204); assert.equal(totals.expectedMinor, 215002);
      const closed = await closeDrawer(tx, session.id, { requestId: uuid(), countedMinor: totals.expectedMinor, reason: "Clôture de vérification" }, f.actor);
      assert.equal(closed.varianceMinor, 0); assert.equal(closed.expectedMinor, 215002);
      assert.equal((await recordWebPayment(tx, pickupId, body, f.actor)).storeReceivedMinor, 20202, "Same-key recovery still works after the drawer closes and goods return");
      throw rollback;
    }, { timeout: 240000, maxWait: 10000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  } catch (e) { if (e !== rollback) throw e; }
  console.log("PASS: confirmation/expiry, pre-dispatch cancellation, pickup cash/stock, delivery != payment, actual courier fees, bank isolation, physical/sellable returns, full merchandise refunds, outstanding courier money after shop refund, durable retry/abandonment, and POS drawer reconciliation. Sequential fixtures rolled back.");

  const setup = await posTransaction(async tx => {
    const f = await fixture(tx); await lockCheckout(tx);
    const original = await tx.storeSetting.findUnique({ where: { key: "checkout.config" } });
    await saveCheckoutSettings(tx, settings(), f.actor);
    const session = await openDrawer(tx, { requestId: uuid(), openingMinor: 100000 }, f.actor);
    const first = await order(tx, f, true, 1), second = await order(tx, f, true, 1);
    const a = await ready(tx, first, f.actor, "STAFF"), b = await ready(tx, second, f.actor, "STAFF");
    await tx.product.update({ where: { id: f.product.id }, data: { status: "ARCHIVED" } });
    if (original) await tx.storeSetting.update({ where: { key: "checkout.config" }, data: { value: original.value } });
    else await tx.storeSetting.delete({ where: { key: "checkout.config" } });
    return { f, session, a, b };
  });
  committed = setup.f;
  const { f, session, a, b } = setup;
  const same = payment(a, session.id);
  const duplicates = await Promise.all([posTransaction(tx => recordWebPayment(tx, a.id, same, f.actor)), posTransaction(tx => recordWebPayment(tx, a.id, same, f.actor))]);
  assert.equal(duplicates[0].payments[0]!.id, duplicates[1].payments[0]!.id);
  assert.equal(await db.webOrderPayment.count({ where: { orderId: a.id } }), 1);
  const racing = payment(b, session.id);
  const race = await Promise.allSettled([
    posTransaction(tx => recordWebPayment(tx, b.id, racing, f.actor)),
    posTransaction(tx => closeDrawer(tx, session.id, { requestId: uuid(), countedMinor: 0, reason: "Concurrence de vérification" }, f.actor)),
  ]);
  assert.equal(race[1]!.status, "fulfilled");
  const saved = await db.registerSession.findUniqueOrThrow({ where: { id: session.id } });
  const receipts = await db.webOrderPayment.aggregate({ where: { registerSessionId: session.id, kind: "RECEIPT" }, _sum: { amountMinor: true } });
  assert.equal(saved.expectedMinor, 100000 + (receipts._sum.amountMinor ?? 0), "Close includes precisely the receipts committed before its lock");
  const stock = await db.inventory.findUniqueOrThrow({ where: { id: f.inventory.id } });
  const count = await db.webOrderPayment.count({ where: { registerSessionId: session.id } });
  assert.equal(stock.onHand, 40 - count); assert.equal(stock.reserved, 2 - count);
  console.log("PASS: concurrent identical receipts post once; cash receipt versus drawer closure cannot lose a committed entry or mutate a closed till.");
} catch (e) {
  console.error("Fulfillment verification failed:", (e as { code?: string }).code || (e as Error).name,
    (e as Error).name === "AssertionError" || (e as { status?: number }).status ? (e as Error).message : "");
  process.exitCode = 1;
} finally {
  if (committed) {
    const f = committed;
    try {
      await posTransaction(async tx => {
        const rows = await tx.webOrder.findMany({ where: { items: { some: { variantId: f.variant.id } } }, select: { id: true } }), ids = rows.map(r => r.id);
        await tx.webOrderCommand.deleteMany({ where: { orderId: { in: ids } } });
        await tx.webOrderPayment.deleteMany({ where: { orderId: { in: ids } } });
        await tx.checkoutAttempt.deleteMany({ where: { orderId: { in: ids } } });
        await tx.webOrderEvent.deleteMany({ where: { orderId: { in: ids } } });
        await tx.webOrderItem.deleteMany({ where: { orderId: { in: ids } } }); await tx.webOrder.deleteMany({ where: { id: { in: ids } } });
        await tx.stockMovement.deleteMany({ where: { userId: f.user.id } });
        await tx.cashRegister.update({ where: { id: f.register.id }, data: { currentSessionId: null } });
        await tx.registerSession.deleteMany({ where: { registerId: f.register.id } }); await tx.cashRegister.delete({ where: { id: f.register.id } });
        await tx.inventory.delete({ where: { id: f.inventory.id } }); await tx.productVariant.delete({ where: { id: f.variant.id } }); await tx.product.delete({ where: { id: f.product.id } });
        await tx.size.delete({ where: { id: f.size.id } }); await tx.color.delete({ where: { id: f.color.id } });
        await tx.auditLog.deleteMany({ where: { userId: f.user.id } });
        await tx.userRole.deleteMany({ where: { userId: f.user.id } });
        await tx.user.delete({ where: { id: f.user.id } });
      });
      console.log("Concurrent verification records cleaned by exact owned IDs. Original store configuration and real records preserved.");
    } catch (e) { console.error("Fulfillment cleanup needs review:", (e as { code?: string }).code || "CLEANUP_FAILED"); process.exitCode = 1; }
  }
  await db.$disconnect();
}
