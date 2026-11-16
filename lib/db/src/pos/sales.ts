import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { CashSaleInput } from "@workspace/api-zod";
import { activeSession, assertNotCancelled, drawerTotals, fail, fingerprint, lockInventory, lockRegister, manager, match, money, readSale, receiptSettings, requestKey, writeBalances, type PosActor, type Tx } from "./shared";

/** Exact largest-remainder allocation; multiplication may exceed JS safe integers. */
export function allocateDiscount(nets: number[], discount: number) {
  const total = nets.reduce((a, b) => a + b, 0);
  if (!discount) return nets.map(() => 0);
  if (discount > total || total <= 0) fail("La remise dépasse le montant des articles.", 400);
  const denominator = BigInt(total);
  const fractions = nets.map((net, i) => ({ i, base: Number(BigInt(net) * BigInt(discount) / denominator), remainder: BigInt(net) * BigInt(discount) % denominator }));
  const remainder = discount - fractions.reduce((sum, f) => sum + f.base, 0);
  const result = fractions.map(f => f.base);
  fractions.sort((a, b) => a.remainder === b.remainder ? a.i - b.i : a.remainder > b.remainder ? -1 : 1);
  for (let i = 0; i < remainder; i++) result[fractions[i]!.i]!++;
  return result;
}
export async function recordCashSale(tx: Tx, input: CashSaleInput, actor: PosActor) {
  requestKey(input.requestId); money(input.orderDiscountMinor); money(input.tenderedMinor);
  if (!input.items.length || input.items.length > 50) fail("Le panier doit contenir entre 1 et 50 variantes.", 400);
  const items = [...input.items].sort((a, b) => a.variantId - b.variantId);
  if (new Set(items.map(i => i.variantId)).size !== items.length) fail("Regroupez les quantités d'une même variante sur une seule ligne.", 400);
  for (const item of items) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 1000) fail("Quantité invalide.", 400);
    money(item.discountMinor); money(item.expectedUnitPriceMinor);
  }
  const discountReason = input.discountReason.trim();
  const hasDiscount = input.orderDiscountMinor > 0 || items.some(i => i.discountMinor > 0);
  if (hasDiscount && !manager(actor)) fail("Les remises nécessitent un responsable.", 403);
  if (hasDiscount && (discountReason.length < 3 || discountReason.length > 500)) fail("Indiquez le motif de remise (3 à 500 caractères).", 400);
  const normalized = { ...input, items, discountReason };
  const requestHash = fingerprint(actor, normalized);
  const register = await lockRegister(tx, actor);
  const previous = await tx.sale.findUnique({ where: { requestId: input.requestId } });
  if (previous) { match(previous.requestHash, requestHash); return readSale(tx, previous.id); }
  await assertNotCancelled(tx, "SALE", input.requestId);
  const session = await activeSession(tx, actor, register, input.registerSessionId, true);
  const ids = items.map(i => i.variantId);
  const references = await tx.productVariant.findMany({ where: { id: { in: ids } }, select: { productId: true } });
  if (references.length !== ids.length) fail("Une variante n'existe plus.", 404);
  const productIds = [...new Set(references.map(v => v.productId))].sort((a, b) => a - b);
  await tx.$queryRaw(Prisma.sql`SELECT id FROM products WHERE id IN (${Prisma.join(productIds)}) ORDER BY id FOR UPDATE`);
  await tx.$queryRaw(Prisma.sql`SELECT id FROM product_variants WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`);
  const variants = await tx.productVariant.findMany({ where: { id: { in: ids } }, include: { product: true, size: true, color: true } });
  const inventory = await lockInventory(tx, ids);
  const lines = items.map(item => {
    const variant = variants.find(v => v.id === item.variantId)!;
    const stock = inventory.find(i => i.variantId === item.variantId)!;
    if (variant.product.status === "ARCHIVED") fail(`Le produit ${variant.product.nameFr} est archivé.`);
    if (variant.priceMinor !== item.expectedUnitPriceMinor) fail(`Le prix de ${variant.sku} a changé. Vérifiez-le avant de confirmer la vente.`);
    if (stock.onHand - stock.reserved < item.quantity) fail(`Stock disponible insuffisant pour ${variant.sku}. Aucun article du panier n'a été débité.`);
    const gross = money(variant.priceMinor * item.quantity);
    if (item.discountMinor > gross) fail("La remise de ligne dépasse son montant.", 400);
    return { item, variant, stock, gross, net: gross - item.discountMinor };
  });
  const subtotalMinor = money(lines.reduce((sum, line) => sum + line.gross, 0));
  const allocation = allocateDiscount(lines.map(l => l.net), input.orderDiscountMinor);
  const discountMinor = money(input.orderDiscountMinor + items.reduce((sum, i) => sum + i.discountMinor, 0));
  const totalMinor = money(subtotalMinor - discountMinor);
  if (input.tenderedMinor < totalMinor) fail("Les espèces reçues sont insuffisantes.", 400);
  const totals = await drawerTotals(tx, session.id, session.openingMinor);
  money(totals.expectedMinor + totalMinor);
  const settings = await receiptSettings(tx);
  const sale = await tx.sale.create({ data: {
    number: `PENDING-${randomUUID()}`, requestId: input.requestId, requestHash, registerSessionId: session.id, userId: actor.id,
    subtotalMinor, discountMinor, discountReason, totalMinor, storeName: "SOFIA STORE",
    storeAddress: settings.address, storePhone: settings.phone, receiptFooter: settings.footer,
  } });
  const year = new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "Africa/Algiers" }).format(sale.createdAt);
  await tx.sale.update({ where: { id: sale.id }, data: { number: `SOF-${year}-${String(sale.id).padStart(6, "0")}` } });
  await tx.saleItem.createMany({ data: lines.map((l, i) => ({
    saleId: sale.id, variantId: l.variant.id, productName: l.variant.product.nameFr, nameAr: l.variant.product.nameAr,
    sku: l.variant.sku, barcode: l.variant.barcode, size: l.variant.size.name, color: l.variant.color.name,
    quantity: l.item.quantity, unitPriceMinor: l.variant.priceMinor, unitCostMinor: l.variant.costMinor,
    discountMinor: l.item.discountMinor + allocation[i]!, lineTotalMinor: l.net - allocation[i]!,
  })) });
  const savedItems = await tx.saleItem.findMany({ where: { saleId: sale.id } });
  await writeBalances(tx, lines.map(l => ({ id: l.stock.id, onHand: l.stock.onHand - l.item.quantity })));
  await tx.stockMovement.createMany({ data: savedItems.map(item => {
    const stock = inventory.find(i => i.variantId === item.variantId)!;
    return {
      variantId: item.variantId, userId: actor.id, quantity: -item.quantity, kind: "SALE", reason: `Vente SOF-${year}-${String(sale.id).padStart(6, "0")}`,
      requestId: `pos-sale-${sale.id}-${item.id}`, requestHash, balanceAfter: stock.onHand - item.quantity, saleItemId: item.id,
    };
  }) });
  await tx.payment.create({ data: { saleId: sale.id, amountMinor: totalMinor, tenderedMinor: input.tenderedMinor, changeMinor: input.tenderedMinor - totalMinor, method: "CASH" } });
  await tx.auditLog.create({ data: { userId: actor.id, action: "POS_SALE_COMPLETED", detail: `Vente ${sale.id}, ${savedItems.length} lignes, ${totalMinor} centimes en espèces. Remise ${discountMinor} centimes.${hasDiscount ? ` Motif : ${discountReason}` : ""}`.slice(0, 500) } });
  return readSale(tx, sale.id);
}
