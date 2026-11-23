import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { CheckoutSubmission, CheckoutAccess, CheckoutCancellation } from "@workspace/api-zod";
import { fail, lockInventory, type Tx } from "../pos/shared";
import { accessKey, authenticateAttempt, digest, lockCheckout, readWebOrder, writeReservations } from "./shared";
import { buildCheckoutQuote } from "./quote";
import { expireCheckoutOrders } from "./lifecycle";

export function normalizeCheckout(input: CheckoutSubmission) {
  accessKey(input);
  let customerPhone = input.customerPhone.replace(/[ ()-]/g, "");
  if (customerPhone.startsWith("00213")) customerPhone = "+" + customerPhone.slice(2);
  if (!/^(?:0|\+213)[1-9][0-9]{8}$/.test(customerPhone)) fail("Numéro de téléphone algérien invalide.", 400);
  const cleaned = {
    ...input, customerPhone, customerName: input.customerName.trim(), address: input.address.trim(),
    commune: input.commune.trim(), notes: input.notes.trim(), zoneCode: input.zoneCode?.trim().toUpperCase() ?? null,
    items: [...input.items].sort((a, b) => a.variantId - b.variantId),
  };
  if (!cleaned.acceptedPolicy || cleaned.customerName.length < 3) fail("Nom et acceptation des conditions obligatoires.", 400);
  if (cleaned.fulfillment === "DELIVERY" && (cleaned.commune.length < 2 || (cleaned.deliveryMode === "HOME" && cleaned.address.length < 5))) fail("Commune obligatoire ; adresse requise pour la livraison à domicile.", 400);
  if (cleaned.deliveryMode === "DESK") cleaned.address = "";
  if (cleaned.fulfillment === "PICKUP") { cleaned.address = ""; cleaned.commune = ""; }
  return cleaned;
}
export async function placeWebOrder(tx: Tx, raw: CheckoutSubmission) {
  const input = normalizeCheckout(raw), tokenHash = digest(input.accessToken);
  const requestHash = digest(JSON.stringify(input));
  await lockCheckout(tx);
  const previous = await tx.checkoutAttempt.findUnique({ where: { requestId: input.requestId } });
  if (previous) {
    authenticateAttempt(previous.tokenHash, input.accessToken);
    if (previous.state === "CANCELLED") fail("Cette tentative a été abandonnée définitivement.");
    if (previous.requestHash !== requestHash || !previous.orderId) fail("Référence déjà utilisée avec un autre panier. Vérifiez votre commande.");
    return readWebOrder(tx, previous.orderId);
  }
  const quote = await buildCheckoutQuote(tx, input, true);
  if (quote.quoteHash !== input.expectedQuoteHash) fail("Prix, tarif ou conditions modifiés. Annulez cette tentative puis vérifiez le nouveau récapitulatif.");
  const now = new Date();
  const row = await tx.webOrder.create({ data: {
    reference: `PENDING-${randomUUID()}`, requestId: input.requestId, fulfillment: quote.fulfillment,
    customerName: input.customerName, customerPhone: input.customerPhone, commune: input.commune, address: input.address, notes: input.notes,
    subtotalMinor: quote.subtotalMinor, feeMinor: quote.feeMinor, totalMinor: quote.totalMinor,
    snapshot: JSON.parse(JSON.stringify(quote)) as Prisma.InputJsonValue,
    expiresAt: new Date(now.getTime() + quote.reservationMinutes * 60000),
  } });
  const year = new Intl.DateTimeFormat("en", { timeZone: "Africa/Algiers", year: "numeric" }).format(now);
  await tx.webOrder.update({ where: { id: row.id }, data: { reference: `WEB-${year}-${String(row.id).padStart(6, "0")}` } });
  const variants = await tx.productVariant.findMany({ where: { id: { in: quote.items.map(i => i.variantId) } }, select: { id: true, costMinor: true } });
  await tx.webOrderItem.createMany({ data: quote.items.map(i => ({ orderId: row.id, variantId: i.variantId, quantity: i.quantity,
    unitPriceMinor: i.unitPriceMinor, unitCostMinor: variants.find(v => v.id === i.variantId)!.costMinor, lineTotalMinor: i.lineTotalMinor })) });
  const stock = await lockInventory(tx, quote.items.map(i => i.variantId));
  await writeReservations(tx, quote.items.map(line => {
    const saved = stock.find(s => s.variantId === line.variantId)!;
    return { id: saved.id, reserved: saved.reserved + line.quantity };
  }));
  await tx.webOrderEvent.create({ data: { orderId: row.id, kind: "PLACED", reason: "Commande reçue, paiement non encaissé ; stock réservé en attente de confirmation." } });
  await tx.checkoutAttempt.create({ data: { requestId: input.requestId, tokenHash, requestHash, state: "COMPLETED", orderId: row.id } });
  return readWebOrder(tx, row.id);
}
export async function recoverWebOrder(tx: Tx, input: CheckoutAccess) {
  accessKey(input);
  await lockCheckout(tx);
  const previous = await tx.checkoutAttempt.findUnique({ where: { requestId: input.requestId } });
  if (!previous) fail("Aucune commande confirmée pour cette référence. Une requête peut encore être en cours.", 404);
  authenticateAttempt(previous.tokenHash, input.accessToken);
  if (!previous.orderId || previous.state === "CANCELLED") fail("Cette tentative a été abandonnée définitivement.");
  await expireCheckoutOrders(tx);
  return readWebOrder(tx, previous.orderId);
}
export async function abandonWebOrderRequest(tx: Tx, input: CheckoutAccess): Promise<CheckoutCancellation> {
  accessKey(input);
  await lockCheckout(tx);
  const previous = await tx.checkoutAttempt.findUnique({ where: { requestId: input.requestId } });
  if (previous) {
    authenticateAttempt(previous.tokenHash, input.accessToken);
    if (previous.orderId) {
      await expireCheckoutOrders(tx);
      return { cancelled: false, order: await readWebOrder(tx, previous.orderId) };
    }
  } else await tx.checkoutAttempt.create({ data: { requestId: input.requestId, tokenHash: digest(input.accessToken), state: "CANCELLED" } });
  return { cancelled: true, order: null };
}
