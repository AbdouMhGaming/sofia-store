import { randomBytes, randomUUID } from "node:crypto";
import { readFile, writeFile, unlink } from "node:fs/promises";
import assert from "node:assert/strict";
import { db, posTransaction } from "@workspace/db";
import { hashPassword } from "../src/lib/security";

const path = "/tmp/sofia-pos-browser-check.json";
type Fixture = { userId: number; email: string; password: string; productId: number; variantId: number; sizeId: number; colorId: number; barcode: string; suffix: string };
try {
  const mode = process.argv[2];
  if (mode === "prepare") {
    try { await readFile(path); throw new Error("Existing verification fixture must be cleaned first."); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    const suffix = randomUUID().slice(0, 8), email = `verify-pos-${suffix}@invalid.test`;
    const password = randomBytes(24).toString("base64url"), passwordHash = await hashPassword(password);
    const barcode = "00" + BigInt("0x" + randomBytes(6).toString("hex")).toString();
    const data = await posTransaction(async tx => {
      const rows = await tx.$queryRaw<{ currentSessionId: number | null }[]>`SELECT currentSessionId FROM cash_registers WHERE code = 'MAIN' FOR UPDATE`;
      assert.equal(rows[0]?.currentSessionId, null, "Do not interfere with an existing drawer session");
      const role = await tx.role.findUniqueOrThrow({ where: { name: "MANAGER" } });
      const user = await tx.user.create({ data: { email, passwordHash, mustChangePassword: false, roles: { create: { roleId: role.id } } } });
      const category = await tx.category.findFirstOrThrow();
      const size = await tx.size.create({ data: { name: `V-${suffix}` } });
      const color = await tx.color.create({ data: { name: `V-${suffix}` } });
      const product = await tx.product.create({ data: { slug: `verification-pos-browser-${suffix}`, nameFr: `VÉRIFICATION CAISSE ${suffix}`, nameAr: "اختبار", descriptionFr: "Article temporaire de vérification.", descriptionAr: "", categoryId: category.id, status: "PREVIEW" } });
      const variant = await tx.productVariant.create({ data: { productId: product.id, sizeId: size.id, colorId: color.id, sku: `VERIFY-${suffix}`, barcode, priceMinor: 10001, costMinor: 0 } });
      const location = await tx.location.findUniqueOrThrow({ where: { code: "STORE" } });
      await tx.inventory.create({ data: { variantId: variant.id, locationId: location.id, onHand: 5, reserved: 0 } });
      await tx.stockMovement.create({ data: { variantId: variant.id, userId: user.id, quantity: 5, kind: "RECEIPT", reason: "Temporary browser verification fixture", requestId: `verify-${randomUUID()}`, requestHash: randomBytes(32).toString("hex"), balanceAfter: 5 } });
      return { userId: user.id, productId: product.id, variantId: variant.id, sizeId: size.id, colorId: color.id };
    });
    await writeFile(path, JSON.stringify({ ...data, email, password, barcode, suffix } satisfies Fixture), { mode: 0o600 });
    console.log("Temporary POS verification fixture prepared; credentials are private and not printed.");
  } else {
    const f: Fixture = JSON.parse(await readFile(path, "utf8"));
    const product = await db.product.findUniqueOrThrow({ where: { id: f.productId } });
    assert.equal(product.slug, `verification-pos-browser-${f.suffix}`);
    const user = await db.user.findUniqueOrThrow({ where: { id: f.userId } });
    assert.equal(user.email, `verify-pos-${f.suffix}@invalid.test`);
    if (mode === "verify") {
      const sales = await db.sale.findMany({ where: { userId: f.userId }, include: { items: true, payment: true, refunds: true } });
      assert.equal(sales.length, 1); const sale = sales[0]!;
      assert.equal(sale.totalMinor, 20002); assert.equal(sale.items[0]!.quantity, 2);
      assert.equal(sale.payment?.tenderedMinor, 30000); assert.equal(sale.payment?.changeMinor, 9998);
      assert.equal(sale.status, "PARTIALLY_REFUNDED");
      assert.equal(sale.refunds.length, 1); assert.equal(sale.refunds[0]!.amountMinor, 10001);
      const session = await db.registerSession.findUniqueOrThrow({ where: { id: sale.registerSessionId } });
      assert.equal(session.status, "CLOSED"); assert.equal(session.expectedMinor, 110001); assert.equal(session.countedMinor, 110001); assert.equal(session.varianceMinor, 0);
      assert.equal((await db.inventory.findFirstOrThrow({ where: { variantId: f.variantId } })).onHand, 4);
      console.log("PASS: browser sale/receipt, single payment, partial restock/refund and closed-drawer balances match persisted MySQL records.");
    } else if (mode === "cleanup") {
      await posTransaction(async tx => {
        assert.equal(await tx.saleItem.count({ where: { variantId: f.variantId, sale: { userId: { not: f.userId } } } }), 0, "Another operator used the verification product; manual review required");
        assert.equal(await tx.saleItem.count({ where: { sale: { userId: f.userId }, variantId: { not: f.variantId } } }), 0, "Test actor touched a real product; manual review required");
        assert.equal(await tx.stockMovement.count({ where: { userId: f.userId, variantId: { not: f.variantId } } }), 0);
        const sessions = await tx.registerSession.findMany({ where: { openedById: f.userId }, select: { id: true } }), ids = sessions.map(s => s.id);
        const registers = await tx.$queryRaw<{ id: number; currentSessionId: number | null }[]>`SELECT id, currentSessionId FROM cash_registers WHERE code = 'MAIN' FOR UPDATE`;
        const register = registers[0]!;
        if (register.currentSessionId && ids.includes(register.currentSessionId)) await tx.cashRegister.update({ where: { id: register.id }, data: { currentSessionId: null } });
        await tx.stockMovement.deleteMany({ where: { userId: f.userId } });
        await tx.refundItem.deleteMany({ where: { refund: { userId: f.userId } } });
        await tx.refund.deleteMany({ where: { userId: f.userId } });
        await tx.payment.deleteMany({ where: { sale: { userId: f.userId } } });
        await tx.saleItem.deleteMany({ where: { sale: { userId: f.userId } } });
        await tx.sale.deleteMany({ where: { userId: f.userId } });
        await tx.posCancellation.deleteMany({ where: { userId: f.userId } });
        await tx.registerSession.deleteMany({ where: { id: { in: ids } } });
        await tx.inventory.deleteMany({ where: { variantId: f.variantId } });
        await tx.productVariant.delete({ where: { id: f.variantId } });
        await tx.product.delete({ where: { id: f.productId } });
        await tx.size.delete({ where: { id: f.sizeId } }); await tx.color.delete({ where: { id: f.colorId } });
        await tx.session.deleteMany({ where: { userId: f.userId } });
        await tx.auditLog.deleteMany({ where: { userId: f.userId } });
        await tx.userRole.deleteMany({ where: { userId: f.userId } });
        await tx.user.delete({ where: { id: f.userId } });
      });
      await unlink(path);
      console.log("Verification-owned product, account, stock and cash records removed; real store records preserved.");
    } else throw new Error("Use prepare, verify or cleanup.");
  }
} catch (error) {
  console.error("POS browser fixture operation failed:", (error as { code?: string }).code || (error as Error).name,
    (error as Error).name === "AssertionError" ? (error as Error).message : "");
  process.exitCode = 1;
} finally { await db.$disconnect(); }
