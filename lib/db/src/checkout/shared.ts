import { createHash, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { GetAdminCheckoutSettingsResponse, QuoteCheckoutResponse } from "@workspace/api-zod";
import type { CheckoutSettings, CheckoutAccess, CheckoutOrder, AdminCheckoutOrder, WebOrderOperation } from "@workspace/api-zod";
import { fail, type Tx } from "../pos/shared";
import { wilayaDefaults } from "./wilayas";

export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export const disabledCheckout = (): CheckoutSettings => ({
  enabled: false, deliveryEnabled: false, pickupEnabled: false,
  pickupAddressFr: "Rue colonel Amirouche, Oued Rhiou, Relizane",
  pickupAddressAr: "شارع العقيد عميروش، وادي رهيو، غليزان", pickupFeeMinor: null,
  reservationMinutes: null, policyFr: "", policyAr: "", zones: wilayaDefaults(),
});
export async function lockCheckout(tx: Tx) {
  const rows = await tx.$queryRaw<{ key: string }[]>`SELECT \`key\` FROM store_settings WHERE \`key\` = 'checkout.lock' FOR UPDATE`;
  if (!rows.length) fail("Commande en ligne indisponible : configuration technique manquante.");
}
export async function writeReservations(tx: Tx, rows: { id: number; reserved: number }[]) {
  if (!rows.length) return;
  await tx.$executeRaw(Prisma.sql`UPDATE inventory SET reserved = CASE id
    ${Prisma.join(rows.map(row => Prisma.sql`WHEN ${row.id} THEN ${row.reserved}`), " ")}
    END WHERE id IN (${Prisma.join(rows.map(row => row.id))})`);
}
export async function checkoutSettings(tx: Tx): Promise<CheckoutSettings> {
  const row = await tx.storeSetting.findUnique({ where: { key: "checkout.config" } });
  if (!row) return disabledCheckout();
  try { return GetAdminCheckoutSettingsResponse.parse(JSON.parse(row.value)); }
  catch { fail("La configuration de vente en ligne est invalide. Contactez la boutique."); }
}
export async function publishCheckoutSettings(tx: Tx) {
  const config = await checkoutSettings(tx);
  return config.enabled ? { ...config, zones: config.zones.map(z => z.enabled ? z : {
    ...z, homeFeeMinor: null, deskFeeMinor: null, homeMinDays: null, homeMaxDays: null, deskMinDays: null, deskMaxDays: null,
  }) } : disabledCheckout();
}
export function accessKey(input: CheckoutAccess) {
  if (!/^[a-f0-9-]{36}$/i.test(input.requestId) || !/^[a-f0-9]{64}$/.test(input.accessToken)) fail("Référence privée invalide.", 400);
}
export function authenticateAttempt(tokenHash: string, token: string) {
  const supplied = digest(token);
  if (tokenHash.length !== supplied.length || !timingSafeEqual(Buffer.from(tokenHash), Buffer.from(supplied))) fail("Commande introuvable.", 404);
}
export const webOrderInclude = {
  items: true, events: { orderBy: { id: "asc" as const } }, payments: { orderBy: { id: "asc" as const } },
} satisfies Prisma.WebOrderInclude;
export type SavedOrder = Prisma.WebOrderGetPayload<{ include: typeof webOrderInclude }>;
export const reservedStates = ["PENDING", "CONFIRMED", "PREPARING", "READY"];
export function orderCapabilities(row: SavedOrder) {
  const receipt = row.payments.find(p => p.kind === "RECEIPT"), refund = row.payments.find(p => p.kind === "REFUND");
  const allowedActions: WebOrderOperation[] = [];
  if (reservedStates.includes(row.status)) allowedActions.push("CANCEL");
  if (row.status === "PENDING" && row.expiresAt > new Date()) allowedActions.push("CONFIRM");
  if (row.status === "CONFIRMED") allowedActions.push("PREPARE");
  if (row.status === "PREPARING") allowedActions.push("READY");
  if (row.status === "READY" && row.fulfillment === "DELIVERY") allowedActions.push("DISPATCH");
  if (row.status === "DISPATCHED") allowedActions.push("DELIVER");
  if (row.status === "DELIVERED" && row.collector === "COURIER" && !row.courierCollected) allowedActions.push("COURIER_COLLECT");
  if (["DISPATCHED", "DELIVERED", "COMPLETED"].includes(row.status)) allowedActions.push("RETURN_START");
  if (row.status === "RETURNING") allowedActions.push("RETURN_RECEIVE");
  const canReceivePayment = !receipt && (
    (row.fulfillment === "PICKUP" && row.status === "READY") ||
    (row.fulfillment === "DELIVERY" && (
      (row.collector === "STAFF" && row.status === "DELIVERED") ||
      (row.collector === "COURIER" && row.courierCollected && ["DELIVERED", "RETURNING", "RETURNED"].includes(row.status))
    )));
  return { allowedActions, canReceivePayment, canRefund: row.status === "RETURNED" && !refund && (!!receipt || row.courierCollected) };
}
export function webOrderOutput(row: SavedOrder): CheckoutOrder {
  const snap = QuoteCheckoutResponse.parse(row.snapshot);
  if (snap.totalMinor !== row.totalMinor || snap.feeMinor !== row.feeMinor || snap.subtotalMinor !== row.subtotalMinor
      || snap.fulfillment !== row.fulfillment || row.items.length !== snap.items.length
      || row.items.some(i => !snap.items.some(s => s.variantId === i.variantId && s.quantity === i.quantity
        && s.unitPriceMinor === i.unitPriceMinor && s.lineTotalMinor === i.lineTotalMinor))) {
    throw new Error("ORDER_SNAPSHOT_INVARIANT");
  }
  return {
    reference: row.reference, requestId: row.requestId, status: row.status as CheckoutOrder["status"],
    createdAt: row.createdAt, expiresAt: row.expiresAt,
    fulfillment: snap.fulfillment, deliveryMode: snap.deliveryMode, deliveryMinDays: snap.deliveryMinDays, deliveryMaxDays: snap.deliveryMaxDays,
    paymentMethod: snap.fulfillment === "DELIVERY" ? "COD" : "CASH_PICKUP",
    paymentStatus: row.payments.some(p => p.kind === "REFUND") ? "REFUNDED"
      : row.payments.some(p => p.kind === "RECEIPT") ? "PAID" : row.courierCollected ? "COLLECTED_BY_COURIER" : "UNPAID",
    storePaymentReceived: row.payments.some(p => p.kind === "RECEIPT"),
    refundedMinor: row.payments.find(p => p.kind === "REFUND")?.amountMinor ?? 0,
    carrierName: row.carrierName, trackingNumber: row.trackingNumber,
    maskedPhone: "******" + row.customerPhone.slice(-4),
    items: snap.items, subtotalMinor: row.subtotalMinor, feeMinor: row.feeMinor, totalMinor: row.totalMinor,
    zoneNameFr: snap.zoneNameFr, zoneNameAr: snap.zoneNameAr, pickupAddressFr: snap.pickupAddressFr, pickupAddressAr: snap.pickupAddressAr,
    policyFr: snap.policyFr, policyAr: snap.policyAr,
  };
}
export function adminWebOrderOutput(row: SavedOrder): AdminCheckoutOrder {
  const receipt = row.payments.find(p => p.kind === "RECEIPT");
  return {
    ...webOrderOutput(row), id: row.id, customerName: row.customerName, customerPhone: row.customerPhone,
    address: row.address, commune: row.commune, notes: row.notes,
    events: row.events.map(e => ({ kind: e.kind, reason: e.reason, createdAt: e.createdAt })),
    collector: row.collector as AdminCheckoutOrder["collector"],
    payments: row.payments.map(p => ({
      id: p.id, number: `WEB-${p.kind === "RECEIPT" ? "ENC" : "REM"}-${new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "Africa/Algiers" }).format(p.createdAt)}-${String(p.id).padStart(6, "0")}`,
      kind: p.kind as "RECEIPT" | "REFUND", method: p.method as "CASH" | "BANK",
      amountMinor: p.amountMinor, feeMinor: p.feeMinor, feeRefundMinor: p.feeRefundMinor,
      tenderedMinor: p.tenderedMinor, changeMinor: p.changeMinor, reference: p.reference, reason: p.reason,
      registerSessionId: p.registerSessionId, actorId: p.userId, receiptSettings: p.receiptSettings as unknown as AdminCheckoutOrder["payments"][number]["receiptSettings"],
      createdAt: p.createdAt,
    })),
    storeReceivedMinor: receipt?.amountMinor ?? 0, carrierFeesMinor: receipt?.feeMinor ?? 0,
    courierOutstandingMinor: row.courierCollected && !receipt ? row.totalMinor : 0,
    ...orderCapabilities(row),
  };
}
export const readWebOrder = async (tx: Tx, id: number) => webOrderOutput(await tx.webOrder.findUniqueOrThrow({ where: { id }, include: webOrderInclude }));
