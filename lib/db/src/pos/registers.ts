import type { ReceiptSettings, RegisterClosing, RegisterOpening } from "@workspace/api-zod";
import { activeSession, assertNotCancelled, drawerTotals, fail, fingerprint, lockRegister, manager, match, money, reason, receiptSettings, registerOutput, requestKey, type PosActor, type Tx } from "./shared";

export async function openDrawer(tx: Tx, input: RegisterOpening, actor: PosActor) {
  requestKey(input.requestId); money(input.openingMinor);
  const requestHash = fingerprint(actor, input);
  const register = await lockRegister(tx, actor);
  const previous = await tx.registerSession.findUnique({ where: { openRequestId: input.requestId } });
  if (previous) { match(previous.openRequestHash, requestHash); return registerOutput(tx, previous.id); }
  await assertNotCancelled(tx, "OPEN", input.requestId);
  if (register.currentSessionId) fail("Une session est déjà ouverte sur cette caisse. Clôturez-la avant d'en ouvrir une autre.");
  const row = await tx.registerSession.create({ data: { registerId: register.id, openedById: actor.id, openingMinor: input.openingMinor, openRequestId: input.requestId, openRequestHash: requestHash } });
  await tx.cashRegister.update({ where: { id: register.id }, data: { currentSessionId: row.id } });
  await tx.auditLog.create({ data: { userId: actor.id, action: "REGISTER_OPENED", detail: `Session ${row.id} ouverte avec ${input.openingMinor} centimes.` } });
  return registerOutput(tx, row.id);
}
export async function closeDrawer(tx: Tx, id: number, input: RegisterClosing, actor: PosActor) {
  requestKey(input.requestId); money(input.countedMinor);
  const closeReason = reason(input.reason), requestHash = fingerprint(actor, { id, ...input, reason: closeReason });
  const register = await lockRegister(tx, actor);
  const previous = await tx.registerSession.findUnique({ where: { closeRequestId: input.requestId } });
  if (previous) { match(previous.closeRequestHash!, requestHash); return registerOutput(tx, previous.id); }
  await assertNotCancelled(tx, "CLOSE", input.requestId);
  const row = await activeSession(tx, actor, register, id, false);
  if (row.openedById !== actor.id && !manager(actor)) fail("Seul le titulaire ou un responsable peut clôturer cette caisse.", 403);
  const totals = await drawerTotals(tx, row.id, row.openingMinor);
  await tx.registerSession.update({ where: { id }, data: {
    status: "CLOSED", closedById: actor.id, closedAt: new Date(), expectedMinor: totals.expectedMinor,
    countedMinor: input.countedMinor, varianceMinor: input.countedMinor - totals.expectedMinor,
    closeReason, closeRequestId: input.requestId, closeRequestHash: requestHash,
  } });
  await tx.cashRegister.update({ where: { id: register.id }, data: { currentSessionId: null } });
  await tx.auditLog.create({ data: { userId: actor.id, action: "REGISTER_CLOSED", detail: `Session ${id} clôturée. Attendu ${totals.expectedMinor}, compté ${input.countedMinor}, écart ${input.countedMinor - totals.expectedMinor} centimes. Motif : ${closeReason}`.slice(0, 500) } });
  return registerOutput(tx, id);
}
export async function saveReceiptSettings(tx: Tx, input: ReceiptSettings, actor: PosActor) {
  if (!manager(actor)) fail("Paramètres réservés à la gestion.", 403);
  const clean = { address: input.address.trim(), phone: input.phone.trim(), footer: input.footer.trim() };
  if (clean.address.length > 500 || clean.phone.length > 60 || clean.footer.length > 500) fail("Coordonnées du ticket trop longues.", 400);
  for (const [key, value] of Object.entries(clean)) {
    await tx.storeSetting.upsert({ where: { key: `receipt.${key}` }, update: { value }, create: { key: `receipt.${key}`, value } });
  }
  await tx.auditLog.create({ data: { userId: actor.id, action: "RECEIPT_SETTINGS_UPDATED", detail: "Coordonnées des futurs tickets modifiées. Les tickets existants restent inchangés." } });
  return receiptSettings(tx);
}
