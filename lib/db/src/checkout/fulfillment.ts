import { Prisma } from "@prisma/client";
import type { WebOrderAction } from "@workspace/api-zod";
import { fail, lockInventory, reason, type PosActor, type Tx } from "../pos/shared";
import { adminWebOrderOutput, digest, orderCapabilities, webOrderInclude, type SavedOrder } from "./shared";
import { beginWebCommand, finishWebCommand } from "./commands";
import { cancelWebOrder } from "./lifecycle";

/** No product locks are acquired after inventory locks. Snapshot prices/names win. */
export async function moveWebStock(tx: Tx, row: SavedOrder, kind: "OUT" | "RETURN", actor: PosActor, explanation: string, restock: number[] = []) {
  const items = row.items.filter(i => kind === "OUT" || restock.includes(i.variantId));
  if (!items.length) return;
  const balances = await lockInventory(tx, items.map(i => i.variantId).sort((a, b) => a - b));
  const changes = balances.map(b => {
    const qty = items.find(i => i.variantId === b.variantId)!.quantity;
    if (kind === "OUT" && (b.reserved < qty || b.onHand < qty)) throw new Error("ORDER_RESERVED_STOCK_INVARIANT");
    const onHand = b.onHand + (kind === "OUT" ? -qty : qty), reserved = b.reserved - (kind === "OUT" ? qty : 0);
    if (!Number.isSafeInteger(onHand) || onHand > 2147483647 || onHand < reserved || reserved < 0) fail("Solde de stock invalide.");
    return { ...b, onHand, reserved, qty: kind === "OUT" ? -qty : qty };
  });
  // One statement is essential: setting physical stock before reserved in separate
  // statements would temporarily violate onHand >= reserved on the last unit.
  await tx.$executeRaw(Prisma.sql`UPDATE inventory SET
    onHand = CASE id ${Prisma.join(changes.map(b => Prisma.sql`WHEN ${b.id} THEN ${b.onHand}`), " ")} END,
    reserved = CASE id ${Prisma.join(changes.map(b => Prisma.sql`WHEN ${b.id} THEN ${b.reserved}`), " ")} END
    WHERE id IN (${Prisma.join(changes.map(b => b.id))})`);
  await tx.stockMovement.createMany({ data: changes.map(b => ({
    variantId: b.variantId, userId: actor.id, quantity: b.qty, kind: `WEB_${kind}`,
    reason: `${row.reference} — ${explanation}`.slice(0, 500), requestId: `WEB-${kind}-${row.id}-${b.variantId}`,
    requestHash: digest(JSON.stringify({ orderId: row.id, kind, variantId: b.variantId, quantity: b.qty })), balanceAfter: b.onHand,
  })) });
}
export async function actOnWebOrder(tx: Tx, id: number, input: WebOrderAction, actor: PosActor) {
  const body = { ...input, reason: reason(input.reason), carrierName: input.carrierName.trim(), trackingNumber: input.trackingNumber.trim() };
  const prior = await beginWebCommand(tx, id, body, actor);
  let row = await tx.webOrder.findUniqueOrThrow({ where: { id }, include: webOrderInclude });
  if (prior.completed) return adminWebOrderOutput(row);
  if (row.status !== body.expectedStatus) fail("L'état de la commande a changé. Récupérez ou abandonnez cette tentative puis rechargez.");
  if (!orderCapabilities(row).allowedActions.includes(body.action)) fail("Cette opération n'est pas autorisée dans l'état actuel.");
  if (body.action !== "CONFIRM" && body.collector !== null) fail("Le collecteur se définit uniquement à la confirmation.", 400);
  if (body.action !== "DISPATCH" && (body.carrierName || body.trackingNumber)) fail("Le suivi se définit uniquement à l'expédition.", 400);
  if (body.action !== "RETURN_RECEIVE" && body.restockVariantIds !== null) fail("La remise en stock exige un retour physique.", 400);
  let status = row.status;
  if (body.action === "CANCEL") {
    await cancelWebOrder(tx, id, body.reason, actor);
    return finishWebCommand(tx, id, body.requestId);
  }
  if (body.action === "CONFIRM") {
    if (!body.collector || (row.fulfillment === "PICKUP" && body.collector !== "STAFF")) fail("Choisissez l'encaissement boutique ou transporteur ; retrait = boutique.", 400);
    if (row.expiresAt <= new Date()) fail("Le délai de confirmation est expiré.");
    status = "CONFIRMED";
    await tx.webOrder.update({ where: { id }, data: { collector: body.collector } });
  }
  if (body.action === "PREPARE") status = "PREPARING";
  if (body.action === "READY") status = "READY";
  if (body.action === "DISPATCH") {
    if (row.collector === "COURIER" && (body.carrierName.length < 2 || body.trackingNumber.length < 2)) fail("Transporteur et référence de suivi réels requis.", 400);
    await moveWebStock(tx, row, "OUT", actor, body.reason);
    status = "DISPATCHED";
    await tx.webOrder.update({ where: { id }, data: { carrierName: body.carrierName, trackingNumber: body.trackingNumber } });
  }
  if (body.action === "DELIVER") status = "DELIVERED";
  if (body.action === "COURIER_COLLECT") {
    await tx.webOrder.update({ where: { id }, data: { courierCollected: true } });
  }
  if (body.action === "RETURN_START") status = "RETURNING";
  if (body.action === "RETURN_RECEIVE") {
    if (!Array.isArray(body.restockVariantIds) || new Set(body.restockVariantIds).size !== body.restockVariantIds.length
      || body.restockVariantIds.some(v => !row.items.some(i => i.variantId === v))) fail("Confirmez explicitement les variantes revenues et revendables, ou aucune.", 400);
    await moveWebStock(tx, row, "RETURN", actor, body.reason, body.restockVariantIds);
    status = "RETURNED";
  }
  await tx.webOrder.update({ where: { id }, data: { status } });
  await tx.webOrderEvent.create({ data: { orderId: id, userId: actor.id, kind: body.action,
    reason: body.action === "RETURN_RECEIVE" ? `${body.reason} — Variantes remises en stock (identifiants) : ${(body.restockVariantIds ?? []).join(", ") || "aucune"}`.slice(0, 500) : body.reason } });
  await tx.auditLog.create({ data: { userId: actor.id, action: `WEB_ORDER_${body.action}`, detail: `Commande ${row.reference} : ${body.action}. ${body.reason}`.slice(0, 500) } });
  return finishWebCommand(tx, id, body.requestId);
}
