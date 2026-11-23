import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import type { PosSale, ReceiptSettings, RegisterSession } from "@workspace/api-zod";

export type Tx = Prisma.TransactionClient;
export type PosActor = { id: number; role: string; registerCode?: string; authVersion?: number };
export const MAX_MONEY = 1000000000;
export const manager = (actor: PosActor) => ["STORE_OWNER", "MANAGER"].includes(actor.role);
export function fail(message: string, status = 409): never { throw Object.assign(new Error(message), { status }); }
export function money(value: number) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_MONEY) fail("Montant invalide ou supérieur à la limite de 10 000 000 DA.", 400);
  return value;
}
export function requestKey(key: string) {
  if (typeof key !== "string" || key.length < 16 || key.length > 100) fail("Référence de requête invalide.", 400);
}
export function reason(value: string) {
  if (typeof value !== "string" || value.trim().length < 3 || value.length > 500) fail("Un motif de 3 à 500 caractères est requis.", 400);
  return value.trim();
}
export function fingerprint(actor: PosActor, payload: unknown) {
  return createHash("sha256").update(JSON.stringify({ userId: actor.id, register: actor.registerCode || "MAIN", payload })).digest("hex");
}
export function match(hash: string, expected: string) {
  if (hash !== expected) fail("Cette référence a déjà été utilisée avec une autre opération. Vérifiez l'historique avant de réessayer.");
}
export async function assertNotCancelled(tx: Tx, kind: string, requestId: string) {
  const row = await tx.posCancellation.findUnique({ where: { kind_requestId: { kind, requestId } } });
  if (row) fail("Cette tentative a été abandonnée définitivement. Vérifiez le résultat de l'annulation avant d'utiliser une nouvelle référence.");
}
export async function lockRegister(tx: Tx, actor: PosActor) {
  const code = actor.registerCode || "MAIN";
  const rows = await tx.$queryRaw<{ id: number; currentSessionId: number | null }[]>`SELECT id, currentSessionId FROM cash_registers WHERE code = ${code} FOR UPDATE`;
  if (!rows[0]) fail("La caisse n'est pas configurée.", 503);
  return rows[0];
}
export async function activeSession(tx: Tx, actor: PosActor, register: { currentSessionId: number | null }, id: number, requireOpener: boolean) {
  if (register.currentSessionId !== id) fail("La session de caisse n'est plus active. Rechargez la caisse.");
  const row = await tx.registerSession.findUnique({ where: { id } });
  if (!row || row.status !== "OPEN") fail("Cette session de caisse est fermée.");
  if (requireOpener && row.openedById !== actor.id) fail("Seul le titulaire de cette session peut y enregistrer une vente.", 403);
  return row;
}
export async function receiptSettings(tx: Tx): Promise<ReceiptSettings> {
  const rows = await tx.storeSetting.findMany({ where: { key: { in: ["receipt.address", "receipt.phone", "receipt.footer"] } } });
  const get = (key: string) => rows.find(r => r.key === `receipt.${key}`)?.value || "";
  return { address: get("address"), phone: get("phone"), footer: get("footer") };
}
export async function drawerTotals(tx: Tx, sessionId: number, openingMinor: number) {
  const [sales, refunds, web] = await Promise.all([
    tx.sale.aggregate({ where: { registerSessionId: sessionId }, _sum: { totalMinor: true } }),
    tx.refund.aggregate({ where: { registerSessionId: sessionId }, _sum: { amountMinor: true } }),
    tx.webOrderPayment.groupBy({ by: ["kind"], where: { registerSessionId: sessionId, method: "CASH" }, _sum: { amountMinor: true } }),
  ]);
  const salesMinor = sales._sum.totalMinor || 0, refundsMinor = refunds._sum.amountMinor || 0;
  const webReceiptsMinor = web.find(p => p.kind === "RECEIPT")?._sum.amountMinor ?? 0;
  const webRefundsMinor = web.find(p => p.kind === "REFUND")?._sum.amountMinor ?? 0;
  return { salesMinor, refundsMinor, webReceiptsMinor, webRefundsMinor, expectedMinor: money(openingMinor + salesMinor + webReceiptsMinor - refundsMinor - webRefundsMinor) };
}
export async function registerOutput(tx: Tx, id: number): Promise<RegisterSession> {
  return (await registerOutputs(tx, [id]))[0]!;
}
export async function registerOutputs(tx: Tx, ids: number[]): Promise<RegisterSession[]> {
  if (!ids.length) return [];
  const [rows, sales, refunds, web] = await Promise.all([
    tx.registerSession.findMany({ where: { id: { in: ids } }, include: { openedBy: true, closedBy: true } }),
    tx.sale.groupBy({ by: ["registerSessionId"], where: { registerSessionId: { in: ids } }, _sum: { totalMinor: true } }),
    tx.refund.groupBy({ by: ["registerSessionId"], where: { registerSessionId: { in: ids } }, _sum: { amountMinor: true } }),
    tx.webOrderPayment.groupBy({ by: ["registerSessionId", "kind"], where: { registerSessionId: { in: ids }, method: "CASH" }, _sum: { amountMinor: true } }),
  ]);
  return ids.map(id => {
    const row = rows.find(r => r.id === id);
    if (!row) fail("Session de caisse introuvable.", 404);
    const salesMinor = sales.find(s => s.registerSessionId === id)?._sum.totalMinor || 0;
    const refundsMinor = refunds.find(s => s.registerSessionId === id)?._sum.amountMinor || 0;
    const webReceiptsMinor = web.find(p => p.registerSessionId === id && p.kind === "RECEIPT")?._sum.amountMinor ?? 0;
    const webRefundsMinor = web.find(p => p.registerSessionId === id && p.kind === "REFUND")?._sum.amountMinor ?? 0;
    const expectedMinor = money(row.openingMinor + salesMinor + webReceiptsMinor - refundsMinor - webRefundsMinor);
    return {
    id: row.id, openedById: row.openedById, openedBy: row.openedBy.email,
    status: row.status as RegisterSession["status"], openingMinor: row.openingMinor,
    salesMinor, refundsMinor, webReceiptsMinor, webRefundsMinor, expectedMinor: row.expectedMinor ?? expectedMinor,
    countedMinor: row.countedMinor, varianceMinor: row.varianceMinor,
    openedAt: row.openedAt.toISOString(), closedAt: row.closedAt?.toISOString() || null,
    closedBy: row.closedBy?.email || null, closeReason: row.closeReason,
    };
  });
}
export const saleInclude = {
  items: { include: { refundItems: true }, orderBy: { id: "asc" as const } },
  payment: true,
  refunds: { include: { items: true }, orderBy: { id: "asc" as const } },
} satisfies Prisma.SaleInclude;
type LoadedSale = Prisma.SaleGetPayload<{ include: typeof saleInclude }>;
export function saleOutput(row: LoadedSale): PosSale {
  if (!row.payment) throw new Error("COMMITTED_SALE_PAYMENT_MISSING");
  return {
    id: row.id, number: row.number, requestId: row.requestId, registerSessionId: row.registerSessionId,
    cashierId: row.userId, status: row.status as PosSale["status"], createdAt: row.createdAt.toISOString(),
    subtotalMinor: row.subtotalMinor, discountMinor: row.discountMinor, discountReason: row.discountReason, totalMinor: row.totalMinor,
    tenderedMinor: row.payment.tenderedMinor, changeMinor: row.payment.changeMinor,
    refundedMinor: row.refunds.reduce((sum, r) => sum + r.amountMinor, 0),
    storeName: row.storeName, receiptSettings: { address: row.storeAddress, phone: row.storePhone, footer: row.receiptFooter },
    items: row.items.map(i => ({
      id: i.id, variantId: i.variantId, productName: i.productName, nameAr: i.nameAr, sku: i.sku, barcode: i.barcode,
      size: i.size, color: i.color, quantity: i.quantity, unitPriceMinor: i.unitPriceMinor, discountMinor: i.discountMinor,
      lineTotalMinor: i.lineTotalMinor, refundedQuantity: i.refundItems.reduce((sum, r) => sum + r.quantity, 0),
    })),
    refunds: row.refunds.map(r => ({
      id: r.id, number: r.number, kind: r.kind, reason: r.reason, amountMinor: r.amountMinor,
      createdAt: r.createdAt.toISOString(), actorId: r.userId, registerSessionId: r.registerSessionId,
      items: r.items.map(i => ({ saleItemId: i.saleItemId, quantity: i.quantity, restock: i.restock, amountMinor: i.amountMinor })),
    })),
  };
}
export async function readSale(tx: Tx, id: number) { return saleOutput(await tx.sale.findUniqueOrThrow({ where: { id }, include: saleInclude })); }
export async function lockInventory(tx: Tx, ids: number[]) {
  const location = await tx.location.findUniqueOrThrow({ where: { code: "STORE" } });
  const rows = await tx.$queryRaw<{ id: number; variantId: number; onHand: number; reserved: number }[]>(Prisma.sql`
    SELECT id, variantId, onHand, reserved FROM inventory WHERE locationId = ${location.id}
    AND variantId IN (${Prisma.join(ids)}) ORDER BY variantId FOR UPDATE`);
  if (rows.length !== ids.length) fail("Une variante n'a pas de stock configuré.", 404);
  return rows;
}
export async function writeBalances(tx: Tx, balances: { id: number; onHand: number }[]) {
  if (!balances.length) return;
  await tx.$executeRaw(Prisma.sql`UPDATE inventory SET onHand = CASE id
    ${Prisma.join(balances.map(b => Prisma.sql`WHEN ${b.id} THEN ${b.onHand}`), " ")}
    END WHERE id IN (${Prisma.join(balances.map(b => b.id))})`);
}
