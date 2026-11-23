import { Prisma } from "@prisma/client";
import type { CheckoutBasket, CheckoutQuote } from "@workspace/api-zod";
import { fail, money, lockInventory, type Tx } from "../pos/shared";
import { checkoutSettings, digest } from "./shared";

export async function buildCheckoutQuote(tx: Tx, input: CheckoutBasket, locked = false): Promise<CheckoutQuote> {
  const config = await checkoutSettings(tx);
  if (!config.enabled) fail("Les commandes en ligne ne sont pas encore ouvertes.");
  const items = [...input.items].sort((a, b) => a.variantId - b.variantId);
  if (!items.length || items.length > 20 || new Set(items.map(i => i.variantId)).size !== items.length
      || items.some(i => !Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > 20)) fail("Panier invalide.", 400);
  const fulfillment = input.fulfillment;
  const zone = fulfillment === "DELIVERY" ? config.zones.find(z => z.enabled && z.code === input.zoneCode?.trim().toUpperCase()) : null;
  if (fulfillment === "DELIVERY" && (!config.deliveryEnabled || !zone)) fail("Cette zone de livraison n'est pas disponible.", 400);
  if (fulfillment === "DELIVERY" && !["HOME", "DESK"].includes(input.deliveryMode ?? "")) fail("Choisissez la livraison à domicile ou au bureau.", 400);
  if (fulfillment === "PICKUP" && (!config.pickupEnabled || input.zoneCode !== null || input.deliveryMode !== null)) fail("Retrait en boutique indisponible ou mode incorrect.", 400);
  const desk = input.deliveryMode === "DESK";
  const feeMinor = fulfillment === "DELIVERY" ? (desk ? zone!.deskFeeMinor : zone!.homeFeeMinor) : config.pickupFeeMinor;
  const deliveryMinDays = fulfillment === "DELIVERY" ? (desk ? zone!.deskMinDays : zone!.homeMinDays) : null;
  const deliveryMaxDays = fulfillment === "DELIVERY" ? (desk ? zone!.deskMaxDays : zone!.homeMaxDays) : null;
  if (feeMinor === null || !config.reservationMinutes) fail("Tarif ou durée de réservation non configurés.");
  if (fulfillment === "DELIVERY" && (deliveryMinDays === null || deliveryMaxDays === null || deliveryMinDays > deliveryMaxDays)) fail("Délai de livraison non configuré.");
  const ids = items.map(i => i.variantId);
  if (locked) {
    const refs = await tx.productVariant.findMany({ where: { id: { in: ids } }, select: { productId: true } });
    const products = [...new Set(refs.map(r => r.productId))].sort((a, b) => a - b);
    if (products.length) await tx.$queryRaw(Prisma.sql`SELECT id FROM products WHERE id IN (${Prisma.join(products)}) ORDER BY id FOR UPDATE`);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM product_variants WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`);
  }
  const variants = await tx.productVariant.findMany({ where: { id: { in: ids } }, include: {
    product: { include: { images: { orderBy: { position: "asc" }, take: 1 } } }, size: true, color: true,
    inventory: { where: { location: { code: "STORE" } } },
  } });
  const inventory = locked ? await lockInventory(tx, ids) : variants.flatMap(v => v.inventory);
  const lines = items.map(item => {
    const v = variants.find(row => row.id === item.variantId), stock = inventory.find(row => row.variantId === item.variantId);
    if (!v || v.product.status !== "ACTIVE" || v.priceMinor <= 0) fail("Une pièce n'est pas encore disponible à la commande.");
    if (!stock || stock.onHand - stock.reserved < item.quantity) fail(`Stock disponible insuffisant pour ${v.sku}. Actualisez le panier.`);
    return { variantId: v.id, productName: v.product.nameFr, nameAr: v.product.nameAr, sku: v.sku, size: v.size.name, color: v.color.name,
      image: v.product.images[0]?.path || "", quantity: item.quantity, unitPriceMinor: money(v.priceMinor), lineTotalMinor: money(v.priceMinor * item.quantity) };
  });
  const subtotalMinor = money(lines.reduce((n, l) => n + l.lineTotalMinor, 0));
  const base = {
    items: lines, subtotalMinor, feeMinor: money(feeMinor), totalMinor: money(subtotalMinor + feeMinor), fulfillment,
    zoneCode: zone?.code ?? null, deliveryMode: input.deliveryMode, deliveryMinDays, deliveryMaxDays,
    zoneNameFr: zone?.nameFr ?? "", zoneNameAr: zone?.nameAr ?? "",
    pickupAddressFr: fulfillment === "PICKUP" ? config.pickupAddressFr : "",
    pickupAddressAr: fulfillment === "PICKUP" ? config.pickupAddressAr : "",
    policyFr: config.policyFr, policyAr: config.policyAr, reservationMinutes: config.reservationMinutes,
  };
  return { ...base, quoteHash: digest(JSON.stringify(base)) };
}
