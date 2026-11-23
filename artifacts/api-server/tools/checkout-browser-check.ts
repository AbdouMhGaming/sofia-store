import { randomBytes, randomUUID } from "node:crypto";
import { readFile, writeFile, unlink } from "node:fs/promises";
import assert from "node:assert/strict";
import { db, posTransaction, lockCheckout } from "@workspace/db";
import { hashPassword, sha256 } from "../src/lib/security";

const file = "/tmp/sofia-checkout-browser-check.json";
type Fixture = {
  suffix: string; marker: string; email: string; password: string; userId: number; productId: number;
  variantId: number; sizeId: number; colorId: number; slug: string; baselineConfig: string | null;
  recovery?: { requestId: string; accessToken: string };
};
try {
  const mode = process.argv[2];
  if (mode === "prepare") {
    try { await readFile(file); throw new Error("Existing checkout fixture must be cleaned first."); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    const suffix = randomUUID().slice(0, 8), email = `verify-web-${suffix}@invalid.test`;
    const password = randomBytes(24).toString("base64url"), passwordHash = await hashPassword(password);
    const slug = `verification-web-${suffix}`, marker = `VERIFICATION-${suffix}`;
    const data = await posTransaction(async tx => {
      await lockCheckout(tx);
      const baseline = await tx.storeSetting.findUnique({ where: { key: "checkout.config" } });
      const role = await tx.role.findUniqueOrThrow({ where: { name: "STORE_OWNER" } });
      const user = await tx.user.create({ data: { email, passwordHash, mustChangePassword: false, roles: { create: { roleId: role.id } } } });
      const category = await tx.category.findFirstOrThrow();
      const size = await tx.size.create({ data: { name: `V-${suffix}` } }), color = await tx.color.create({ data: { name: `V-${suffix}` } });
      const product = await tx.product.create({ data: { slug, nameFr: `VÉRIFICATION COMMANDE ${suffix}`, nameAr: `اختبار طلب ${suffix}`,
        descriptionFr: "Article temporaire de vérification, ne pas acheter.", descriptionAr: "قطعة اختبار مؤقتة، ليست للبيع.",
        status: "ACTIVE", categoryId: category.id, images: { create: { path: "/products/dress-1.jpeg", position: 0 } } } });
      const variant = await tx.productVariant.create({ data: { productId: product.id, sizeId: size.id, colorId: color.id, sku: `V-WEB-${suffix}`, barcode: `00WEB${suffix}`, priceMinor: 12345, costMinor: 0 } });
      const location = await tx.location.findUniqueOrThrow({ where: { code: "STORE" } });
      await tx.inventory.create({ data: { variantId: variant.id, locationId: location.id, onHand: 5, reserved: 0 } });
      return { userId: user.id, productId: product.id, variantId: variant.id, sizeId: size.id, colorId: color.id, baselineConfig: baseline?.value ?? null };
    });
    await writeFile(file, JSON.stringify({ ...data, suffix, marker, email, password, slug } satisfies Fixture), { mode: 0o600 });
    console.log("Temporary checkout verification fixture prepared. Private credentials were not printed.");
  } else {
    const f: Fixture = JSON.parse(await readFile(file, "utf8"));
    assert.equal((await db.product.findUniqueOrThrow({ where: { id: f.productId } })).slug, f.slug);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: f.userId } })).email, f.email);
    const orders = await db.webOrder.findMany({ where: { items: { some: { variantId: f.variantId } } }, include: { items: true, events: true } });
    if (mode === "recover-fixture") {
      assert.equal(orders.length, 1);
      const order = orders[0]!;
      assert.ok(order.items.every(i => i.variantId === f.variantId));
      const recovery = { requestId: order.requestId, accessToken: randomBytes(32).toString("hex") };
      await posTransaction(async tx => {
        await lockCheckout(tx);
        const attempt = await tx.checkoutAttempt.findUniqueOrThrow({ where: { orderId: order.id } });
        assert.equal(attempt.requestId, recovery.requestId); assert.equal(attempt.state, "COMPLETED");
        await tx.checkoutAttempt.update({ where: { requestId: recovery.requestId }, data: { tokenHash: sha256(recovery.accessToken) } });
      });
      await writeFile(file, JSON.stringify({ ...f, recovery }), { mode: 0o600 });
      console.log("Restored private recovery capability for the existing verification-owned order only; no order or stock was created or changed.");
    } else if (mode === "verify") {
      assert.equal(orders.length, 1);
      const order = orders[0]!;
      assert.equal(order.subtotalMinor, 24690); assert.equal(order.feeMinor, 30000); assert.equal(order.totalMinor, 54690);
      assert.equal(order.status, "CANCELLED");
      const snap = order.snapshot as { deliveryMode: string; deliveryMinDays: number; deliveryMaxDays: number };
      assert.equal(snap.deliveryMode, "DESK"); assert.equal(snap.deliveryMinDays, 1); assert.equal(snap.deliveryMaxDays, 3);
      assert.equal(order.events.filter(e => e.kind === "PLACED").length, 1);
      assert.equal(order.events.filter(e => e.kind === "CANCELLED").length, 1);
      const stock = await db.inventory.findFirstOrThrow({ where: { variantId: f.variantId } });
      assert.equal(stock.onHand, 5); assert.equal(stock.reserved, 0);
      assert.equal(await db.checkoutAttempt.count({ where: { orderId: order.id, state: "COMPLETED" } }), 1);
      console.log("PASS: one saved/recovered desk-delivery order, exact tariff/ETA, two reserved units, single manager cancellation and full reservation release; no online cash payment.");
    } else if (mode === "cleanup" || mode === "restore") {
      await posTransaction(async tx => {
        await lockCheckout(tx);
        const ids = orders.map(o => o.id);
        assert.ok(orders.every(o => o.items.every(i => i.variantId === f.variantId)), "Mixed real/test order needs manual review");
        assert.equal(await tx.saleItem.count({ where: { variantId: f.variantId } }), 0, "Real POS touched fixture; manual review required");
        const current = await tx.storeSetting.findUnique({ where: { key: "checkout.config" } });
        const lastEditor = await tx.auditLog.findFirst({ where: { action: "CHECKOUT_SETTINGS_UPDATED" }, orderBy: { id: "desc" } });
        if (current && lastEditor?.userId === f.userId && current.value.includes(f.marker)) {
          if (f.baselineConfig === null) await tx.storeSetting.delete({ where: { key: "checkout.config" } });
          else await tx.storeSetting.update({ where: { key: "checkout.config" }, data: { value: f.baselineConfig } });
        } else if (current?.value.includes(f.marker)) {
          throw new Error("Checkout settings changed by another operator; restore requires review.");
        }
        if (mode === "restore") return;
        await tx.checkoutAttempt.deleteMany({ where: { orderId: { in: ids } } });
        await tx.webOrderEvent.deleteMany({ where: { orderId: { in: ids } } });
        await tx.webOrderItem.deleteMany({ where: { orderId: { in: ids } } });
        await tx.webOrder.deleteMany({ where: { id: { in: ids } } });
        await tx.inventory.deleteMany({ where: { variantId: f.variantId } });
        await tx.productVariant.delete({ where: { id: f.variantId } });
        await tx.productImage.deleteMany({ where: { productId: f.productId } });
        await tx.product.delete({ where: { id: f.productId } });
        await tx.size.delete({ where: { id: f.sizeId } }); await tx.color.delete({ where: { id: f.colorId } });
        await tx.session.deleteMany({ where: { userId: f.userId } });
        await tx.auditLog.deleteMany({ where: { userId: f.userId } });
        await tx.userRole.deleteMany({ where: { userId: f.userId } });
        await tx.user.delete({ where: { id: f.userId } });
      });
      if (mode === "cleanup") await unlink(file);
      console.log(mode === "cleanup"
        ? "Verification-owned orders/account/product removed; pre-test settings restored without overwriting a real operator's changes."
        : "Temporary verification settings restored where still test-owned; other operator changes preserved. Recovery fixture kept for the reload check.");
    } else throw new Error("Use prepare, verify, restore, recover-fixture or cleanup.");
  }
} catch (e) {
  console.error("Checkout browser fixture operation failed:", (e as { code?: string }).code || (e as Error).name,
    (e as Error).name === "AssertionError" ? (e as Error).message : "");
  process.exitCode = 1;
} finally { await db.$disconnect(); }
