import { Prisma } from "@prisma/client";
import { fail, lockInventory, manager, reason, type Tx, type PosActor } from "../pos/shared";
import { lockCheckout, adminWebOrderOutput, webOrderInclude, writeReservations, reservedStates } from "./shared";

/** Caller owns checkout lock before changing order states; stock is locked in variant order. */
async function releaseOrders(tx: Tx, ids: number[], status: "EXPIRED" | "CANCELLED", explanation: string, userId: number | null) {
  if (!ids.length) return;
  await tx.$queryRaw(Prisma.sql`SELECT id FROM web_orders WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`);
  const rows = await tx.webOrder.findMany({ where: { id: { in: ids }, status: { in: status === "EXPIRED" ? ["PENDING"] : reservedStates } }, include: { items: true } });
  if (!rows.length) return;
  const quantities = new Map<number, number>();
  for (const row of rows) for (const item of row.items) quantities.set(item.variantId, (quantities.get(item.variantId) || 0) + item.quantity);
  const stocks = await lockInventory(tx, [...quantities.keys()].sort((a, b) => a - b));
  for (const stock of stocks) {
    const amount = quantities.get(stock.variantId)!;
    if (stock.reserved < amount) throw new Error("ORDER_RESERVED_STOCK_INVARIANT");
  }
  await writeReservations(tx, stocks.map(s => ({ id: s.id, reserved: s.reserved - quantities.get(s.variantId)! })));
  await tx.webOrder.updateMany({ where: { id: { in: rows.map(r => r.id) } }, data: { status } });
  await tx.webOrderEvent.createMany({ data: rows.map(row => ({ orderId: row.id, userId, kind: status, reason: explanation })) });
}
export async function expireCheckoutOrders(tx: Tx) {
  await lockCheckout(tx);
  const rows = await tx.webOrder.findMany({ where: { status: "PENDING", expiresAt: { lte: new Date() } }, orderBy: { id: "asc" }, take: 20, select: { id: true } });
  await releaseOrders(tx, rows.map(r => r.id), "EXPIRED", "Délai de confirmation expiré ; réservation de stock libérée.", null);
  return rows.length;
}
export async function cancelWebOrder(tx: Tx, id: number, explanation: string, actor: PosActor) {
  if (!manager(actor)) fail("Accès responsable requis.", 403);
  const clean = reason(explanation);
  await lockCheckout(tx);
  const row = await tx.webOrder.findUnique({ where: { id } });
  if (!row) fail("Commande introuvable.", 404);
  if (reservedStates.includes(row.status)) {
    await releaseOrders(tx, [id], "CANCELLED", clean, actor.id);
    await tx.auditLog.create({ data: { userId: actor.id, action: "WEB_ORDER_CANCELLED", detail: `Commande ${id} annulée. Réservation libérée ; aucun paiement en ligne n'avait été encaissé.` } });
  }
  else if (!["CANCELLED", "EXPIRED"].includes(row.status)) fail("La commande a quitté le stock : enregistrez un retour physique, pas une annulation.");
  return adminWebOrderOutput(await tx.webOrder.findUniqueOrThrow({ where: { id }, include: webOrderInclude }));
}
