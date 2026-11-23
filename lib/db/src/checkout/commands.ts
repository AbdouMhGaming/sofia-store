import type { WebOrderRequestKey } from "@workspace/api-zod";
import { fail, fingerprint, manager, match, type PosActor, type Tx } from "../pos/shared";
import { adminWebOrderOutput, lockCheckout, webOrderInclude } from "./shared";

export function webRequestKey(key: string) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(key)) fail("Référence de requête invalide.", 400);
}
export async function beginWebCommand(tx: Tx, orderId: number, payload: WebOrderRequestKey & object, actor: PosActor) {
  if (!manager(actor)) fail("Accès responsable requis.", 403);
  webRequestKey(payload.requestId);
  await lockCheckout(tx);
  const previous = await tx.webOrderCommand.findUnique({ where: { requestId: payload.requestId } });
  const hash = fingerprint(actor, { orderId, ...payload });
  if (previous) {
    if (previous.orderId !== orderId || previous.userId !== actor.id) fail("Cette tentative appartient à une autre opération ou personne.", 403);
    if (previous.state === "CANCELLED") fail("Cette tentative a été abandonnée définitivement.");
    if (previous.state !== "COMPLETED") fail("Le résultat de cette tentative n'est pas confirmé.");
    match(previous.requestHash!, hash);
    return { completed: true as const };
  }
  if (!await tx.webOrder.findUnique({ where: { id: orderId }, select: { id: true } })) fail("Commande introuvable.", 404);
  // Creation and result commit in the same transaction. No orphan PROCESSING row
  // survives a rollback, so a missing lookup still requires durable abandonment.
  await tx.webOrderCommand.create({ data: { requestId: payload.requestId, orderId, userId: actor.id, requestHash: hash, state: "PROCESSING" } });
  return { completed: false as const };
}
export async function finishWebCommand(tx: Tx, orderId: number, requestId: string) {
  await tx.webOrderCommand.update({ where: { requestId }, data: { state: "COMPLETED" } });
  return adminWebOrderOutput(await tx.webOrder.findUniqueOrThrow({ where: { id: orderId }, include: webOrderInclude }));
}
export async function recoverWebCommand(tx: Tx, orderId: number, requestId: string, actor: PosActor) {
  if (!manager(actor)) fail("Accès responsable requis.", 403);
  webRequestKey(requestId);
  const row = await tx.webOrderCommand.findUnique({ where: { requestId } });
  if (!row || row.orderId !== orderId || row.userId !== actor.id) fail("Tentative introuvable. Ne créez pas de nouvelle référence sans abandon confirmé.", 404);
  if (row.state === "CANCELLED") return { state: "CANCELLED" as const, order: null };
  if (row.state !== "COMPLETED") fail("Résultat encore en cours.");
  return { state: "COMPLETED" as const, order: adminWebOrderOutput(await tx.webOrder.findUniqueOrThrow({ where: { id: orderId }, include: webOrderInclude })) };
}
export async function abandonWebCommand(tx: Tx, orderId: number, requestId: string, actor: PosActor) {
  if (!manager(actor)) fail("Accès responsable requis.", 403);
  webRequestKey(requestId);
  await lockCheckout(tx);
  const row = await tx.webOrderCommand.findUnique({ where: { requestId } });
  if (row) return recoverWebCommand(tx, orderId, requestId, actor);
  if (!await tx.webOrder.findUnique({ where: { id: orderId }, select: { id: true } })) fail("Commande introuvable.", 404);
  await tx.webOrderCommand.create({ data: { requestId, orderId, userId: actor.id, state: "CANCELLED" } });
  return { state: "CANCELLED" as const, order: null };
}
