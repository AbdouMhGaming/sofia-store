import type { WebOrderPaymentInput } from "@workspace/api-zod";
import { activeSession, drawerTotals, fail, lockRegister, money, reason, receiptSettings, type PosActor, type Tx } from "../pos/shared";
import { adminWebOrderOutput, orderCapabilities, webOrderInclude } from "./shared";
import { beginWebCommand, finishWebCommand } from "./commands";
import { moveWebStock } from "./fulfillment";

export async function recordWebPayment(tx: Tx, id: number, input: WebOrderPaymentInput, actor: PosActor) {
  const body = { ...input, reason: reason(input.reason), reference: input.reference.trim() };
  for (const amount of [body.amountMinor, body.feeMinor, body.feeRefundMinor]) money(amount);
  if (body.reference.length > 150) fail("Référence trop longue.", 400);
  const previous = await beginWebCommand(tx, id, body, actor);
  const row = await tx.webOrder.findUniqueOrThrow({ where: { id }, include: webOrderInclude });
  if (previous.completed) return adminWebOrderOutput(row);
  if (row.status !== body.expectedStatus) fail("L'état de la commande a changé. Récupérez ou abandonnez cette tentative.");
  const capabilities = orderCapabilities(row);
  if (body.kind === "RECEIPT") {
    if (!capabilities.canReceivePayment) fail("Encaissement impossible ou déjà enregistré.");
    if (row.fulfillment === "PICKUP" && body.method !== "CASH") fail("Le retrait boutique se règle en espèces dans la caisse.", 400);
    if (body.feeRefundMinor !== 0) fail("Aucun remboursement de frais sur un encaissement.", 400);
    if (row.collector !== "COURIER" && body.feeMinor !== 0) fail("Seul un reversement transporteur peut comporter une retenue.", 400);
    if (money(body.amountMinor + body.feeMinor) !== row.totalMinor) fail("Le net reçu et les retenues doivent égaler le total client original.");
  } else {
    if (!capabilities.canRefund) fail("Le retour complet et le paiement client sont requis ; un remboursement ne peut être enregistré qu'une fois.");
    if (body.feeMinor !== 0 || body.feeRefundMinor > row.feeMinor) fail("Frais de remboursement invalides.", 400);
    if (body.amountMinor !== money(row.subtotalMinor + body.feeRefundMinor)) fail("Remboursez toutes les marchandises et uniquement les frais explicitement choisis.");
  }
  let changeMinor = 0;
  if (body.method === "CASH") {
    if (!body.registerSessionId) fail("Une caisse active est requise pour les espèces.", 400);
    const register = await lockRegister(tx, actor);
    const session = await activeSession(tx, actor, register, body.registerSessionId, false);
    const totals = await drawerTotals(tx, session.id, session.openingMinor);
    if (body.kind === "RECEIPT") {
      if (body.tenderedMinor === null) fail("Saisissez les espèces réellement remises.", 400);
      money(body.tenderedMinor);
      if (body.tenderedMinor < body.amountMinor) fail("Espèces remises insuffisantes.", 400);
      changeMinor = body.tenderedMinor - body.amountMinor;
      money(totals.expectedMinor + body.amountMinor);
    } else {
      if (body.tenderedMinor !== null) fail("Un remboursement n'est pas un paiement remis par le client.", 400);
      if (totals.expectedMinor < body.amountMinor) fail("Fonds de caisse insuffisants pour ce remboursement.");
    }
  } else {
    if (body.registerSessionId !== null || body.tenderedMinor !== null || body.reference.length < 3) fail("Un virement exige sa référence réelle, sans espèces ni session de caisse.", 400);
  }
  if (body.kind === "RECEIPT" && row.fulfillment === "PICKUP") await moveWebStock(tx, row, "OUT", actor, "Retrait remis et encaissé en boutique.");
  const payment = await tx.webOrderPayment.create({ data: {
    orderId: id, userId: actor.id, kind: body.kind, method: body.method, amountMinor: body.amountMinor,
    feeMinor: body.feeMinor, feeRefundMinor: body.feeRefundMinor, tenderedMinor: body.tenderedMinor, changeMinor,
    reference: body.reference, reason: body.reason, registerSessionId: body.registerSessionId,
    receiptSettings: { ...await receiptSettings(tx) },
  } });
  if (body.kind === "RECEIPT" && ["READY", "DELIVERED"].includes(row.status)) await tx.webOrder.update({ where: { id }, data: { status: "COMPLETED" } });
  await tx.webOrderEvent.create({ data: { orderId: id, userId: actor.id, kind: body.kind, reason: `${body.kind === "RECEIPT" ? "Reçu boutique" : "Remboursé par la boutique"} : ${body.amountMinor} centimes, ${body.method}. ${body.reason}`.slice(0, 500) } });
  await tx.auditLog.create({ data: { userId: actor.id, action: `WEB_PAYMENT_${body.kind}`, detail: `Commande ${row.reference}, mouvement ${payment.id} : ${body.amountMinor} centimes ${body.method} ; retenues ${body.feeMinor}.` } });
  return finishWebCommand(tx, id, body.requestId);
}
