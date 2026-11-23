import { createHash, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { GetAdminCheckoutSettingsResponse, QuoteCheckoutResponse } from "@workspace/api-zod";
import type { CheckoutSettings, CheckoutAccess, CheckoutOrder, AdminCheckoutOrder } from "@workspace/api-zod";
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
  items: true, events: { orderBy: { id: "asc" as const } },
} satisfies Prisma.WebOrderInclude;
type SavedOrder = Prisma.WebOrderGetPayload<{ include: typeof webOrderInclude }>;
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
    paymentMethod: snap.fulfillment === "DELIVERY" ? "COD" : "CASH_PICKUP", paymentStatus: "UNPAID",
    maskedPhone: "******" + row.customerPhone.slice(-4),
    items: snap.items, subtotalMinor: row.subtotalMinor, feeMinor: row.feeMinor, totalMinor: row.totalMinor,
    zoneNameFr: snap.zoneNameFr, zoneNameAr: snap.zoneNameAr, pickupAddressFr: snap.pickupAddressFr, pickupAddressAr: snap.pickupAddressAr,
    policyFr: snap.policyFr, policyAr: snap.policyAr,
  };
}
export function adminWebOrderOutput(row: SavedOrder): AdminCheckoutOrder {
  return {
    ...webOrderOutput(row), id: row.id, customerName: row.customerName, customerPhone: row.customerPhone,
    address: row.address, commune: row.commune, notes: row.notes,
    events: row.events.map(e => ({ kind: e.kind, reason: e.reason, createdAt: e.createdAt })),
  };
}
export const readWebOrder = async (tx: Tx, id: number) => webOrderOutput(await tx.webOrder.findUniqueOrThrow({ where: { id }, include: webOrderInclude }));
