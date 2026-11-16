import type { PosSaleCancellation, PosRefundCancellation, RegisterCancellation, SaleCancellationResult, RegisterCancellationResult } from "@workspace/api-zod";
import { fail, lockRegister, manager, readSale, registerOutput, requestKey, type PosActor, type Tx } from "./shared";

async function tombstone(tx: Tx, kind: string, key: string, registerId: number, actor: PosActor) {
  const previous = await tx.posCancellation.findUnique({ where: { kind_requestId: { kind, requestId: key } } });
  if (previous) {
    if (previous.userId !== actor.id || previous.registerId !== registerId) fail("Référence déjà utilisée par une autre opération.");
    return;
  }
  await tx.posCancellation.create({ data: { kind, requestId: key, userId: actor.id, registerId } });
  await tx.auditLog.create({ data: { userId: actor.id, action: "POS_ATTEMPT_CANCELLED", detail: `Tentative ${kind} abandonnée. La référence ne pourra plus exécuter une opération tardive.` } });
}
export async function cancelSaleAttempt(tx: Tx, input: PosSaleCancellation, actor: PosActor): Promise<SaleCancellationResult> {
  requestKey(input.requestId);
  const register = await lockRegister(tx, actor);
  const previous = await tx.sale.findUnique({ where: { requestId: input.requestId } });
  if (previous) {
    if (previous.userId !== actor.id) fail("Cette référence n'appartient pas à votre session utilisateur.", 403);
    return { cancelled: false, sale: await readSale(tx, previous.id) };
  }
  await tombstone(tx, "SALE", input.requestId, register.id, actor);
  return { cancelled: true, sale: null };
}
export async function cancelRefundAttempt(tx: Tx, input: PosRefundCancellation, actor: PosActor): Promise<SaleCancellationResult> {
  if (!manager(actor)) fail("Autorisation d'un responsable requise.", 403);
  requestKey(input.requestId);
  const register = await lockRegister(tx, actor);
  const previous = await tx.refund.findUnique({ where: { requestId: input.requestId } });
  if (previous) {
    if (previous.userId !== actor.id || previous.saleId !== input.saleId) fail("Référence liée à une autre opération.", 403);
    return { cancelled: false, sale: await readSale(tx, previous.saleId) };
  }
  await tombstone(tx, "REFUND", input.requestId, register.id, actor);
  return { cancelled: true, sale: null };
}
export async function cancelRegisterAttempt(tx: Tx, input: RegisterCancellation, actor: PosActor): Promise<RegisterCancellationResult> {
  requestKey(input.requestId);
  if (!["OPEN", "CLOSE"].includes(input.kind) || (input.kind === "CLOSE" && !input.registerSessionId)) fail("Tentative d'ouverture/clôture invalide.", 400);
  const register = await lockRegister(tx, actor);
  const previous = await tx.registerSession.findUnique({ where: input.kind === "OPEN" ? { openRequestId: input.requestId } : { closeRequestId: input.requestId } });
  if (previous) {
    const author = input.kind === "OPEN" ? previous.openedById : previous.closedById;
    if (author !== actor.id) fail("Référence liée à une autre opération.", 403);
    return { cancelled: false, session: await registerOutput(tx, previous.id) };
  }
  await tombstone(tx, input.kind, input.requestId, register.id, actor);
  return { cancelled: true, session: null };
}
