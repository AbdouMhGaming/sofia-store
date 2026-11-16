import type { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";

export type StockAdjustment = {
  variantId: number;
  quantity: number;
  reason: string;
  kind: string;
  requestId: string;
};
function conflict(message: string, status = 409): never {
  throw Object.assign(new Error(message), { status });
}
export async function applyStockAdjustment(tx: Prisma.TransactionClient, data: StockAdjustment, userId: number) {
  if (!Number.isSafeInteger(data.quantity) || !data.quantity || Math.abs(data.quantity) > 100000) conflict("Quantité invalide.", 400);
  if (!["RECEIPT", "ADJUSTMENT", "DAMAGE", "RETURN"].includes(data.kind) || data.reason.trim().length < 3) conflict("Type ou motif invalide.", 400);
  if ((data.kind === "DAMAGE" && data.quantity > 0) || (["RECEIPT", "RETURN"].includes(data.kind) && data.quantity < 0)) conflict("Signe de quantité invalide.", 400);
  const requestHash = createHash("sha256").update(JSON.stringify({
    variantId: data.variantId, quantity: data.quantity, reason: data.reason,
    kind: data.kind, requestId: data.requestId, userId,
  })).digest("hex");
  const location = await tx.location.findUniqueOrThrow({ where: { code: "STORE" } });
  const rows = await tx.$queryRaw<{ id: number; onHand: number; reserved: number }[]>`
    SELECT id, onHand, reserved FROM inventory WHERE variantId = ${data.variantId} AND locationId = ${location.id} FOR UPDATE`;
  const inventory = rows[0];
  if (!inventory) conflict("Variante introuvable.", 404);
  const previous = await tx.stockMovement.findUnique({ where: { requestId: data.requestId } });
  if (previous) {
    if (previous.requestHash !== requestHash) conflict("Cette référence a déjà été utilisée pour un autre mouvement.");
    return;
  }
  const balanceAfter = inventory.onHand + data.quantity;
  if (balanceAfter < inventory.reserved) conflict("Le stock ne peut pas devenir inférieur au stock réservé.");
  await tx.inventory.update({ where: { id: inventory.id }, data: { onHand: balanceAfter } });
  await tx.stockMovement.create({ data: { ...data, userId, requestHash, balanceAfter } });
  await tx.auditLog.create({ data: { userId, action: `STOCK_${data.kind}`, detail: `Variante ${data.variantId} : ${data.quantity > 0 ? "+" : ""}${data.quantity}. Motif : ${data.reason}` } });
}
