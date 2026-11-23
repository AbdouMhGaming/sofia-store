import { randomBytes, randomUUID } from "node:crypto";
import { readFile, writeFile, unlink } from "node:fs/promises";
import assert from "node:assert/strict";
import { db, posTransaction, lockCheckout, disabledCheckout, saveCheckoutSettings, buildCheckoutQuote, placeWebOrder } from "@workspace/db";
import { hashPassword } from "../src/lib/security";

const file = "/tmp/sofia-fulfillment-browser-check.json";
type Fixture = { suffix: string; email: string; password: string; userId: number; productId: number; variantId: number;
  sizeId: number; colorId: number; orderId: number; reference: string; access: { requestId: string; accessToken: string } };
try {
  if (process.env.NODE_ENV === "production") throw new Error("Development verification only");
  const mode = process.argv[2];
  if (mode === "prepare") {
    try { await readFile(file); throw new Error("Clean the previous fixture first"); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    const suffix = randomUUID().slice(0, 8), email = `verify-fulfillment-${suffix}@invalid.test`;
    const password = randomBytes(24).toString("base64url"), passwordHash = await hashPassword(password);
    const data = await posTransaction(async tx => {
      await lockCheckout(tx);
      const original = await tx.storeSetting.findUnique({ where: { key: "checkout.config" } });
      const role = await tx.role.findUniqueOrThrow({ where: { name: "MANAGER" } });
      const user = await tx.user.create({ data: { email, passwordHash, mustChangePassword: false, roles: { create: { roleId: role.id } } } });
      const category = await tx.category.findFirstOrThrow(), size = await tx.size.create({ data: { name: `V-${suffix}` } }), color = await tx.color.create({ data: { name: `V-${suffix}` } });
      const product = await tx.product.create({ data: { slug: `verify-fulfillment-${suffix}`, nameFr: `VÉRIFICATION COMMANDE ${suffix}`, nameAr: `اختبار طلب ${suffix}`,
        categoryId: category.id, descriptionFr: "Article de vérification, pas une offre réelle.", descriptionAr: "قطعة اختبار ليست للبيع.", status: "ACTIVE",
        images: { create: { path: "/products/dress-1.jpeg", position: 0 } } } });
      const variant = await tx.productVariant.create({ data: { productId: product.id, sizeId: size.id, colorId: color.id, sku: `VF-${suffix}`, barcode: `00VF${suffix}`, priceMinor: 12345, costMinor: 0 } });
      const location = await tx.location.findUniqueOrThrow({ where: { code: "STORE" } });
      await tx.inventory.create({ data: { locationId: location.id, variantId: variant.id, onHand: 5, reserved: 0 } });
      const cfg = disabledCheckout(); cfg.enabled = cfg.deliveryEnabled = true; cfg.reservationMinutes = 60;
      cfg.policyFr = "Conditions de vérification seulement, pas une offre réelle."; cfg.policyAr = "شروط اختبار فقط، ليست عروضاً حقيقية.";
      Object.assign(cfg.zones[47]!, { enabled: true, homeFeeMinor: 50000, homeMinDays: 2, homeMaxDays: 4 });
      await saveCheckoutSettings(tx, cfg, { id: user.id, role: "STORE_OWNER" });
      const basket = { items: [{ variantId: variant.id, quantity: 2 }], fulfillment: "DELIVERY" as const, zoneCode: "48", deliveryMode: "HOME" as const };
      const quote = await buildCheckoutQuote(tx, basket);
      const access = { requestId: randomUUID(), accessToken: randomBytes(32).toString("hex") };
      const saved = await placeWebOrder(tx, { ...basket, ...access, expectedQuoteHash: quote.quoteHash, customerName: `Client de vérification ${suffix}`, customerPhone: "0550000000",
        commune: "Oued Rhiou", address: "Adresse temporaire de vérification", notes: "Vérification interne seulement", acceptedPolicy: true });
      const order = await tx.webOrder.findUniqueOrThrow({ where: { requestId: access.requestId } });
      await tx.product.update({ where: { id: product.id }, data: { status: "ARCHIVED" } });
      if (original) await tx.storeSetting.update({ where: { key: "checkout.config" }, data: { value: original.value } });
      else await tx.storeSetting.delete({ where: { key: "checkout.config" } });
      return { userId: user.id, productId: product.id, variantId: variant.id, sizeId: size.id, colorId: color.id, orderId: order.id, reference: saved.reference, access };
    });
    await writeFile(file, JSON.stringify({ ...data, suffix, email, password } satisfies Fixture), { mode: 0o600 });
    console.log("Private manager/order fixture prepared. Public settings unchanged; product archived; no credentials/capability printed.");
  } else {
    const f: Fixture = JSON.parse(await readFile(file, "utf8"));
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: f.userId } })).email, f.email);
    assert.equal((await db.product.findUniqueOrThrow({ where: { id: f.productId } })).slug, `verify-fulfillment-${f.suffix}`);
    const order = await db.webOrder.findUniqueOrThrow({ where: { id: f.orderId }, include: { payments: true, items: true, events: true, commands: true } });
    assert.ok(order.items.every(i => i.variantId === f.variantId));
    if (mode === "verify") {
      assert.equal(order.status, "RETURNED"); assert.equal(order.totalMinor, 74690);
      assert.equal(order.payments.length, 2);
      const receipt = order.payments.find(p => p.kind === "RECEIPT")!, refund = order.payments.find(p => p.kind === "REFUND")!;
      assert.equal(receipt.method, "BANK"); assert.equal(receipt.amountMinor, 64690); assert.equal(receipt.feeMinor, 10000);
      assert.equal(receipt.tenderedMinor, null); assert.equal(receipt.changeMinor, 0);
      assert.equal(refund.amountMinor, 24690); assert.equal(refund.feeRefundMinor, 0);
      assert.equal(refund.method, "BANK"); assert.equal(refund.tenderedMinor, null);
      assert.equal(receipt.registerSessionId, null); assert.equal(refund.registerSessionId, null);
      assert.equal(await db.registerSession.count({ where: { openedById: f.userId } }), 0, "Real till untouched");
      const stock = await db.inventory.findFirstOrThrow({ where: { variantId: f.variantId } });
      assert.equal(stock.onHand, 5); assert.equal(stock.reserved, 0);
      assert.equal(await db.stockMovement.count({ where: { variantId: f.variantId, kind: "WEB_OUT" } }), 1);
      assert.equal(await db.stockMovement.count({ where: { variantId: f.variantId, kind: "WEB_RETURN" } }), 1);
      assert.equal(order.commands.filter(c => c.state === "COMPLETED").length, 10);
      console.log("PASS: courier delivery, distinct customer collection/store receipt, one net bank payout and bank refund, physical return once and immutable receipt totals match MySQL. No cash register session touched.");
    } else if (mode === "cleanup") {
      await posTransaction(async tx => {
        await lockCheckout(tx);
        assert.equal(await tx.webOrderItem.count({ where: { variantId: f.variantId, orderId: { not: f.orderId } } }), 0);
        const sessions = await tx.registerSession.findMany({ where: { openedById: f.userId }, select: { id: true } }), ids = sessions.map(s => s.id);
        assert.equal(await tx.sale.count({ where: { registerSessionId: { in: ids } } }), 0, "Other activity in verification till needs review");
        assert.equal(await tx.refund.count({ where: { registerSessionId: { in: ids } } }), 0);
        assert.equal(await tx.webOrderPayment.count({ where: { registerSessionId: { in: ids }, OR: [{ orderId: { not: f.orderId } }, { userId: { not: f.userId } }] } }), 0);
        assert.equal(ids.length, 0, "Bank verification must never have opened or changed a real till");
        await tx.webOrderCommand.deleteMany({ where: { orderId: f.orderId } }); await tx.webOrderPayment.deleteMany({ where: { orderId: f.orderId } });
        await tx.checkoutAttempt.deleteMany({ where: { orderId: f.orderId } }); await tx.webOrderEvent.deleteMany({ where: { orderId: f.orderId } });
        await tx.webOrderItem.deleteMany({ where: { orderId: f.orderId } }); await tx.webOrder.delete({ where: { id: f.orderId } });
        await tx.stockMovement.deleteMany({ where: { userId: f.userId } });
        await tx.posCancellation.deleteMany({ where: { userId: f.userId } }); await tx.registerSession.deleteMany({ where: { id: { in: ids } } });
        await tx.inventory.deleteMany({ where: { variantId: f.variantId } }); await tx.productVariant.delete({ where: { id: f.variantId } });
        await tx.productImage.deleteMany({ where: { productId: f.productId } }); await tx.product.delete({ where: { id: f.productId } });
        await tx.size.delete({ where: { id: f.sizeId } }); await tx.color.delete({ where: { id: f.colorId } });
        await tx.session.deleteMany({ where: { userId: f.userId } }); await tx.auditLog.deleteMany({ where: { userId: f.userId } });
        await tx.userRole.deleteMany({ where: { userId: f.userId } }); await tx.user.delete({ where: { id: f.userId } });
      });
      await unlink(file); console.log("Exact verification-owned order, ledger, till session, stock, product and manager removed. Original business settings preserved.");
    } else throw new Error("Use prepare, verify or cleanup");
  }
} catch (e) {
  console.error("Fulfillment browser fixture failed:", (e as { code?: string }).code || (e as Error).name,
    (e as Error).name === "AssertionError" ? (e as Error).message : "");
  process.exitCode = 1;
} finally { await db.$disconnect(); }
