import { randomUUID } from "node:crypto";
import type { RefundInput } from "@workspace/api-zod";
import { activeSession, assertNotCancelled, drawerTotals, fail, fingerprint, lockInventory, lockRegister, manager, match, readSale, reason, requestKey, saleInclude, writeBalances, type PosActor, type Tx } from "./shared";

export function refundAmount(total: number, quantity: number, already: number, returned: number) {
  return Number(BigInt(total) * BigInt(already + returned) / BigInt(quantity) - BigInt(total) * BigInt(already) / BigInt(quantity));
}
export async function recordRefund(tx: Tx, saleId: number, input: RefundInput, actor: PosActor) {
  if (!manager(actor)) fail("Seul un responsable peut autoriser un remboursement ou une annulation.", 403);
  requestKey(input.requestId);
  const why = reason(input.reason), items = [...input.items].sort((a, b) => a.saleItemId - b.saleItemId);
  if (!items.length || items.length > 50 || new Set(items.map(i => i.saleItemId)).size !== items.length) fail("Lignes de remboursement invalides.", 400);
  if (!["RETURN", "VOID"].includes(input.kind)) fail("Type de remboursement invalide.", 400);
  const requestHash = fingerprint(actor, { saleId, ...input, items, reason: why });
  const register = await lockRegister(tx, actor);
  const previous = await tx.refund.findUnique({ where: { requestId: input.requestId } });
  if (previous) { match(previous.requestHash, requestHash); return readSale(tx, previous.saleId); }
  await assertNotCancelled(tx, "REFUND", input.requestId);
  const session = await activeSession(tx, actor, register, input.registerSessionId, false);
  await tx.$queryRaw`SELECT id FROM sales WHERE id = ${saleId} FOR UPDATE`;
  const sale = await tx.sale.findUnique({ where: { id: saleId }, include: saleInclude });
  if (!sale) fail("Vente introuvable.", 404);
  if (["REFUNDED", "VOIDED"].includes(sale.status)) fail("Cette vente a déjà été entièrement retournée ou annulée.");
  if (input.kind === "VOID" && (sale.refunds.length || sale.registerSessionId !== session.id || items.length !== sale.items.length)) fail("Une annulation doit couvrir la vente entière, sans retour précédent, dans sa session de caisse encore ouverte.");
  const lines = items.map(item => {
    const original = sale.items.find(i => i.id === item.saleItemId);
    if (!original) fail("Une ligne n'appartient pas à cette vente.", 400);
    const already = original.refundItems.reduce((sum, r) => sum + r.quantity, 0);
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > original.quantity - already) fail("La quantité dépasse le solde retournable.");
    if (input.kind === "VOID" && (item.quantity !== original.quantity || !item.restock)) fail("Une annulation restitue tous les articles au stock.", 400);
    return { item, original, already, amount: refundAmount(original.lineTotalMinor, original.quantity, already, item.quantity) };
  });
  const amountMinor = lines.reduce((sum, l) => sum + l.amount, 0);
  const totals = await drawerTotals(tx, session.id, session.openingMinor);
  if (amountMinor > totals.expectedMinor) fail("Espèces insuffisantes dans la caisse active pour ce remboursement.");
  const restocked = lines.filter(l => l.item.restock);
  const inventory = restocked.length ? await lockInventory(tx, restocked.map(l => l.original.variantId).sort((a, b) => a - b)) : [];
  const refund = await tx.refund.create({ data: {
    number: `PENDING-${randomUUID()}`, requestId: input.requestId, requestHash, saleId, registerSessionId: session.id,
    userId: actor.id, kind: input.kind, reason: why, amountMinor,
  } });
  const number = `${input.kind === "VOID" ? "ANN" : "RET"}-${String(refund.id).padStart(6, "0")}`;
  await tx.refund.update({ where: { id: refund.id }, data: { number } });
  await tx.refundItem.createMany({ data: lines.map(l => ({ refundId: refund.id, saleItemId: l.original.id, quantity: l.item.quantity, restock: l.item.restock, amountMinor: l.amount })) });
  const saved = await tx.refundItem.findMany({ where: { refundId: refund.id } });
  await writeBalances(tx, restocked.map(l => {
    const stock = inventory.find(i => i.variantId === l.original.variantId)!;
    return { id: stock.id, onHand: stock.onHand + l.item.quantity };
  }));
  const movements = saved.filter(i => i.restock).map(i => {
    const original = sale.items.find(s => s.id === i.saleItemId)!;
    const stock = inventory.find(s => s.variantId === original.variantId)!;
    return {
      variantId: original.variantId, userId: actor.id, quantity: i.quantity, kind: input.kind === "VOID" ? "VOID" : "REFUND",
      reason: `${number} : ${why}`.slice(0, 500), requestId: `pos-refund-${refund.id}-${i.id}`, requestHash,
      balanceAfter: stock.onHand + i.quantity, refundItemId: i.id,
    };
  });
  if (movements.length) await tx.stockMovement.createMany({ data: movements });
  const returned = sale.items.reduce((sum, i) => sum + i.refundItems.reduce((n, r) => n + r.quantity, 0), 0) + items.reduce((sum, i) => sum + i.quantity, 0);
  const all = sale.items.reduce((sum, i) => sum + i.quantity, 0);
  await tx.sale.update({ where: { id: saleId }, data: { status: input.kind === "VOID" ? "VOIDED" : returned === all ? "REFUNDED" : "PARTIALLY_REFUNDED" } });
  await tx.auditLog.create({ data: { userId: actor.id, action: input.kind === "VOID" ? "POS_SALE_VOIDED" : "POS_REFUND_COMPLETED", detail: `${number}, vente ${sale.number}, ${amountMinor} centimes en espèces. Motif : ${why}`.slice(0, 500) } });
  return readSale(tx, saleId);
}
