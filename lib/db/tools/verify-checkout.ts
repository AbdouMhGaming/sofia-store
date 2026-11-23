import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import {
  db, Prisma, posTransaction, disabledCheckout, saveCheckoutSettings, buildCheckoutQuote, placeWebOrder,
  recoverWebOrder, abandonWebOrderRequest, cancelWebOrder, expireCheckoutOrders, openDrawer, recordCashSale, lockCheckout,
  type PosActor,
} from "../src/index";
import type { CheckoutSettings, CheckoutBasket, CheckoutSubmission } from "@workspace/api-zod";

const uuid = () => randomUUID();
const token = () => randomBytes(32).toString("hex");
const rollback = new Error("ROLLBACK_CHECKOUT_VERIFICATION");
const keys: string[] = [];
let committed: Awaited<ReturnType<typeof fixture>> | undefined;
async function fixture(tx: Prisma.TransactionClient) {
  const suffix = uuid().slice(0, 8);
  const user = await tx.user.create({ data: { email: `checkout-${suffix}@invalid.test`, passwordHash: "DISABLED_VERIFICATION_ACCOUNT", active: false } });
  const actor: PosActor = { id: user.id, role: "STORE_OWNER", registerCode: `V-WEB-${suffix}` };
  const register = await tx.cashRegister.create({ data: { code: actor.registerCode!, name: `VÉRIFICATION ${suffix}` } });
  const category = await tx.category.findFirstOrThrow();
  const size = await tx.size.create({ data: { name: `V-W-${suffix}` } });
  const color = await tx.color.create({ data: { name: `V-W-${suffix}` } });
  const product = await tx.product.create({ data: { slug: `verify-checkout-${suffix}`, nameFr: `VÉRIFICATION COMMANDE ${suffix}`, nameAr: "اختبار", descriptionFr: "", descriptionAr: "", categoryId: category.id, status: "ARCHIVED" } });
  const variant = await tx.productVariant.create({ data: { productId: product.id, sizeId: size.id, colorId: color.id, sku: `V-WEB-${suffix}`, barcode: `00VWEB${suffix}`, priceMinor: 10001, costMinor: 5000 } });
  const location = await tx.location.findUniqueOrThrow({ where: { code: "STORE" } });
  const inventory = await tx.inventory.create({ data: { variantId: variant.id, locationId: location.id, onHand: 3, reserved: 0 } });
  return { user, actor, register, product, size, color, variant, inventory };
}
function config(): CheckoutSettings {
  const result = disabledCheckout();
  result.enabled = result.pickupEnabled = result.deliveryEnabled = true;
  result.pickupFeeMinor = 0; result.reservationMinutes = 60;
  result.policyFr = "Conditions temporaires de vérification, aucun commerce réel.";
  result.policyAr = "شروط اختبار مؤقتة لا تمثل طلبات تجارية حقيقية.";
  Object.assign(result.zones.find(z => z.code === "48")!, {
    enabled: true, homeFeeMinor: 50000, deskFeeMinor: 30000,
    homeMinDays: 2, homeMaxDays: 4, deskMinDays: 1, deskMaxDays: 3,
  });
  return result;
}
function basket(id: number, quantity = 1): CheckoutBasket {
  return { items: [{ variantId: id, quantity }], fulfillment: "DELIVERY", zoneCode: "48", deliveryMode: "HOME" };
}
function submission(cart: CheckoutBasket, hash: string): CheckoutSubmission {
  const requestId = uuid(); keys.push(requestId);
  return { ...cart, requestId, accessToken: token(), expectedQuoteHash: hash, customerName: "Vérification uniquement", customerPhone: "0550000000",
    address: "Adresse temporaire de vérification", commune: "Commune de vérification", notes: "", acceptedPolicy: true };
}
try {
  assert.equal(disabledCheckout().zones.length, 58);
  assert.equal(new Set(disabledCheckout().zones.map(z => z.code)).size, 58);
  assert.ok(disabledCheckout().zones.every(z => z.homeFeeMinor === null && z.deskFeeMinor === null && z.homeMinDays === null && z.deskMaxDays === null));
  assert.equal(disabledCheckout().pickupAddressFr, "Rue colonel Amirouche, Oued Rhiou, Relizane");
  try {
    await db.$transaction(async tx => {
      const f = await fixture(tx), cfg = config();
      await lockCheckout(tx);
      await assert.rejects(saveCheckoutSettings(tx, cfg, { ...f.actor, role: "MANAGER" }), /propriétaire/);
      await assert.rejects(saveCheckoutSettings(tx, { ...cfg, reservationMinutes: null }, f.actor), /Durée/);
      const incomplete = config(); incomplete.zones[47]!.homeMaxDays = null;
      await assert.rejects(saveCheckoutSettings(tx, incomplete, f.actor), /Délai/);
      await saveCheckoutSettings(tx, cfg, f.actor);
      const cart = basket(f.variant.id, 2);
      await assert.rejects(buildCheckoutQuote(tx, cart), /pièce/);
      await tx.product.update({ where: { id: f.product.id }, data: { status: "PREVIEW" } });
      await assert.rejects(buildCheckoutQuote(tx, cart), /pièce/);
      await tx.product.update({ where: { id: f.product.id }, data: { status: "ACTIVE" } });
      const quote = await buildCheckoutQuote(tx, cart);
      assert.equal(quote.subtotalMinor, 20002); assert.equal(quote.feeMinor, 50000); assert.equal(quote.totalMinor, 70002);
      assert.deepEqual([quote.deliveryMinDays, quote.deliveryMaxDays], [2, 4]);
      const desk = await buildCheckoutQuote(tx, { ...cart, deliveryMode: "DESK" });
      assert.equal(desk.feeMinor, 30000); assert.deepEqual([desk.deliveryMinDays, desk.deliveryMaxDays], [1, 3]);
      await assert.rejects(buildCheckoutQuote(tx, { ...cart, zoneCode: "01" }), /zone/);
      const input = submission(cart, quote.quoteHash);
      await assert.rejects(placeWebOrder(tx, { ...input, expectedQuoteHash: "0".repeat(64) }), /modifiés/);
      assert.equal(await tx.webOrder.count({ where: { requestId: input.requestId } }), 0);
      const order = await placeWebOrder(tx, input);
      assert.equal(order.paymentStatus, "UNPAID"); assert.equal(order.status, "PENDING");
      assert.ok(!("customerName" in order) && !("customerPhone" in order) && !("address" in order));
      assert.equal(order.maskedPhone, "******0000");
      assert.equal((await tx.inventory.findUniqueOrThrow({ where: { id: f.inventory.id } })).reserved, 2);
      assert.equal((await placeWebOrder(tx, input)).reference, order.reference);
      assert.equal((await tx.inventory.findUniqueOrThrow({ where: { id: f.inventory.id } })).reserved, 2);
      await assert.rejects(placeWebOrder(tx, { ...input, notes: "changed" }), /autre panier/);
      await assert.rejects(recoverWebOrder(tx, { ...input, accessToken: token() }), /introuvable/);
      assert.equal((await recoverWebOrder(tx, input)).reference, order.reference);
      const session = await openDrawer(tx, { openingMinor: 0, requestId: uuid() }, f.actor);
      const cashInput = { requestId: uuid(), registerSessionId: session.id, items: [{ variantId: f.variant.id, expectedUnitPriceMinor: 10001, quantity: 2, discountMinor: 0 }], orderDiscountMinor: 0, discountReason: "", tenderedMinor: 30000 };
      await assert.rejects(recordCashSale(tx, cashInput, f.actor), /Stock disponible/);
      await recordCashSale(tx, { ...cashInput, requestId: uuid(), items: [{ ...cashInput.items[0]!, quantity: 1 }] }, f.actor);
      const held = await tx.inventory.findUniqueOrThrow({ where: { id: f.inventory.id } });
      assert.equal(held.onHand, 2); assert.equal(held.reserved, 2);
      await saveCheckoutSettings(tx, { ...cfg, enabled: false }, f.actor);
      assert.equal((await placeWebOrder(tx, input)).reference, order.reference, "Retry after checkout disabled returns committed order");
      await assert.rejects(buildCheckoutQuote(tx, basket(f.variant.id)), /pas encore ouvertes/);
      const saved = await tx.webOrder.findUniqueOrThrow({ where: { requestId: input.requestId } });
      await assert.rejects(cancelWebOrder(tx, saved.id, "Vérification", { ...f.actor, role: "CASHIER" }), /responsable/);
      const cancelled = await cancelWebOrder(tx, saved.id, "Vérification", f.actor);
      assert.equal(cancelled.status, "CANCELLED");
      await cancelWebOrder(tx, saved.id, "Autre raison", f.actor);
      assert.equal(await tx.webOrderEvent.count({ where: { orderId: saved.id, kind: "CANCELLED" } }), 1);
      assert.equal((await tx.inventory.findUniqueOrThrow({ where: { id: f.inventory.id } })).reserved, 0);
      assert.equal((await abandonWebOrderRequest(tx, input)).cancelled, false);
      await saveCheckoutSettings(tx, cfg, f.actor);
      const pickup: CheckoutBasket = { ...basket(f.variant.id), fulfillment: "PICKUP", zoneCode: null, deliveryMode: null };
      const pickupQuote = await buildCheckoutQuote(tx, pickup);
      const pending = submission(pickup, pickupQuote.quoteHash);
      await abandonWebOrderRequest(tx, pending);
      await assert.rejects(placeWebOrder(tx, pending), /abandonnée/);
      const expiredInput = submission(pickup, pickupQuote.quoteHash);
      const expiring = await placeWebOrder(tx, expiredInput);
      assert.equal(expiring.paymentMethod, "CASH_PICKUP"); assert.equal(expiring.feeMinor, 0);
      assert.equal(expiring.deliveryMinDays, null);
      const expiringRow = await tx.webOrder.update({ where: { requestId: expiredInput.requestId }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await expireCheckoutOrders(tx); await expireCheckoutOrders(tx);
      assert.equal((await tx.webOrder.findUniqueOrThrow({ where: { id: expiringRow.id } })).status, "EXPIRED");
      assert.equal((await tx.inventory.findUniqueOrThrow({ where: { id: f.inventory.id } })).reserved, 0);
      assert.equal(await tx.webOrderEvent.count({ where: { orderId: expiringRow.id, kind: "EXPIRED" } }), 1);
      const deskInput = submission({ ...basket(f.variant.id), deliveryMode: "DESK" }, (await buildCheckoutQuote(tx, { ...basket(f.variant.id), deliveryMode: "DESK" })).quoteHash);
      deskInput.address = "";
      const deskOrder = await placeWebOrder(tx, deskInput);
      assert.equal(deskOrder.feeMinor, 30000); assert.equal(deskOrder.deliveryMode, "DESK");
      await tx.productVariant.update({ where: { id: f.variant.id }, data: { priceMinor: 90000 } });
      await tx.product.update({ where: { id: f.product.id }, data: { nameFr: "NOM MODIFIÉ" } });
      const changed = config(); changed.zones[47]!.deskFeeMinor = 99999;
      await saveCheckoutSettings(tx, changed, f.actor);
      const historical = await recoverWebOrder(tx, deskInput);
      assert.equal(historical.items[0]!.unitPriceMinor, 10001); assert.equal(historical.feeMinor, 30000);
      assert.ok(historical.items[0]!.productName.includes("VÉRIFICATION"));
      throw rollback;
    }, { timeout: 240000, maxWait: 10000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  } catch (e) { if (e !== rollback) throw e; }
  console.log("PASS: 58 blank-fee wilayas, home/desk fees and ETAs, owner-only configuration, ACTIVE-only items, quotes, unpaid orders, private recovery, idempotency, POS reserved-stock protection, single release/expiry and immutable snapshots. Sequential fixtures rolled back.");
  committed = await posTransaction(fixture);
  const f = committed;
  const session = await posTransaction(tx => openDrawer(tx, { openingMinor: 0, requestId: uuid() }, f.actor));
  async function restoreConfig(tx: Prisma.TransactionClient, originalConfig: { value: string } | null) {
    if (originalConfig) await tx.storeSetting.update({ where: { key: "checkout.config" }, data: { value: originalConfig.value } });
    else await tx.storeSetting.delete({ where: { key: "checkout.config" } });
  }
  async function online(input: CheckoutSubmission) {
    return posTransaction(async tx => {
      await lockCheckout(tx);
      const originalConfig = await tx.storeSetting.findUnique({ where: { key: "checkout.config" } });
      await saveCheckoutSettings(tx, config(), f.actor);
      await tx.product.update({ where: { id: f.product.id }, data: { status: "ACTIVE" } });
      const result = await placeWebOrder(tx, input);
      await tx.product.update({ where: { id: f.product.id }, data: { status: "ARCHIVED" } });
      await restoreConfig(tx, originalConfig);
      return result;
    });
  }
  const cart = basket(f.variant.id);
  const initial = await posTransaction(async tx => {
    await lockCheckout(tx);
    const originalConfig = await tx.storeSetting.findUnique({ where: { key: "checkout.config" } });
    await saveCheckoutSettings(tx, config(), f.actor);
    await tx.product.update({ where: { id: f.product.id }, data: { status: "ACTIVE" } });
    const quote = await buildCheckoutQuote(tx, cart);
    await tx.product.update({ where: { id: f.product.id }, data: { status: "ARCHIVED" } }); await restoreConfig(tx, originalConfig);
    return submission(cart, quote.quoteHash);
  });
  await db.inventory.update({ where: { id: f.inventory.id }, data: { onHand: 1 } });
  const cash = posTransaction(async tx => {
    await tx.product.update({ where: { id: f.product.id }, data: { status: "ACTIVE" } });
    const result = await recordCashSale(tx, { requestId: uuid(), registerSessionId: session.id, items: [{ variantId: f.variant.id, quantity: 1, expectedUnitPriceMinor: 10001, discountMinor: 0 }], orderDiscountMinor: 0, discountReason: "", tenderedMinor: 20000 }, f.actor);
    await tx.product.update({ where: { id: f.product.id }, data: { status: "ARCHIVED" } });
    return result;
  });
  const race = await Promise.allSettled([online(initial), cash]);
  assert.equal(race.filter(r => r.status === "fulfilled").length, 1, "Only POS or online checkout may claim the last unit");
  const afterRace = await db.inventory.findUniqueOrThrow({ where: { id: f.inventory.id } });
  assert.ok(afterRace.onHand >= afterRace.reserved);
  if (race[0]!.status === "fulfilled") {
    const row = await db.webOrder.findUniqueOrThrow({ where: { requestId: initial.requestId } });
    await posTransaction(tx => cancelWebOrder(tx, row.id, "Vérification de concurrence", f.actor));
  }
  await db.inventory.update({ where: { id: f.inventory.id }, data: { onHand: 3, reserved: 0 } });
  const duplicate = { ...initial, requestId: uuid(), accessToken: token() }; keys.push(duplicate.requestId);
  const same = await Promise.all([online(duplicate), online(duplicate)]);
  assert.equal(same[0].reference, same[1].reference);
  assert.equal((await db.inventory.findUniqueOrThrow({ where: { id: f.inventory.id } })).reserved, 1);
  const late = { ...initial, requestId: uuid(), accessToken: token() }; keys.push(late.requestId);
  await posTransaction(tx => abandonWebOrderRequest(tx, late));
  await assert.rejects(online(late), /abandonnée/);
  const cancelRace = { ...initial, requestId: uuid(), accessToken: token() }; keys.push(cancelRace.requestId);
  const [created, abandoned] = await Promise.allSettled([online(cancelRace), posTransaction(tx => abandonWebOrderRequest(tx, cancelRace))]);
  assert.equal(abandoned.status, "fulfilled");
  if (abandoned.status === "fulfilled") {
    if (created.status === "fulfilled") { assert.equal(abandoned.value.cancelled, false); assert.equal(abandoned.value.order?.reference, created.value.reference); }
    else assert.equal(abandoned.value.cancelled, true);
  }
  console.log("PASS: simultaneous checkout/POS last-unit competition, same-key checkout retries, late placement after durable cancellation, and placement-versus-abandonment race.");
} catch (e) {
  console.error("Checkout verification failed:", (e as { code?: string }).code || (e as Error).name,
    (e as Error).name === "AssertionError" || (e as { status?: number }).status ? (e as Error).message : "");
  process.exitCode = 1;
} finally {
  if (committed) {
    const f = committed;
    try {
      await posTransaction(async tx => {
        const orders = await tx.webOrder.findMany({ where: { items: { some: { variantId: f.variant.id } } }, select: { id: true } });
        const ids = orders.map(o => o.id);
        await tx.checkoutAttempt.deleteMany({ where: { OR: [{ requestId: { in: keys } }, { orderId: { in: ids } }] } });
        await tx.webOrderEvent.deleteMany({ where: { orderId: { in: ids } } });
        await tx.webOrderItem.deleteMany({ where: { orderId: { in: ids } } });
        await tx.webOrder.deleteMany({ where: { id: { in: ids } } });
        await tx.stockMovement.deleteMany({ where: { userId: f.user.id } });
        await tx.payment.deleteMany({ where: { sale: { userId: f.user.id } } });
        await tx.saleItem.deleteMany({ where: { sale: { userId: f.user.id } } });
        await tx.sale.deleteMany({ where: { userId: f.user.id } });
        await tx.cashRegister.update({ where: { id: f.register.id }, data: { currentSessionId: null } });
        await tx.registerSession.deleteMany({ where: { registerId: f.register.id } });
        await tx.cashRegister.delete({ where: { id: f.register.id } });
        await tx.inventory.delete({ where: { id: f.inventory.id } });
        await tx.productVariant.delete({ where: { id: f.variant.id } });
        await tx.product.delete({ where: { id: f.product.id } });
        await tx.size.delete({ where: { id: f.size.id } }); await tx.color.delete({ where: { id: f.color.id } });
        await tx.auditLog.deleteMany({ where: { userId: f.user.id } });
        await tx.user.delete({ where: { id: f.user.id } });
      });
      console.log("Concurrent-test records removed by exact verification-owned IDs; real store data preserved.");
    } catch (e) { console.error("Checkout verification cleanup needs attention:", (e as { code?: string }).code || "CLEANUP_FAILED"); process.exitCode = 1; }
  }
  await db.$disconnect();
}
