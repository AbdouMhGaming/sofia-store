import type { CheckoutSettings } from "@workspace/api-zod";
import { fail, type PosActor, type Tx } from "../pos/shared";
import { lockCheckout } from "./shared";
import { wilayaDefaults } from "./wilayas";

export async function saveCheckoutSettings(tx: Tx, input: CheckoutSettings, actor: PosActor) {
  if (actor.role !== "STORE_OWNER") fail("Seule la propriétaire peut activer ou configurer la vente en ligne.", 403);
  const config: CheckoutSettings = {
    ...input, pickupAddressFr: input.pickupAddressFr.trim(), pickupAddressAr: input.pickupAddressAr.trim(),
    policyFr: input.policyFr.trim(), policyAr: input.policyAr.trim(),
    zones: input.zones.map(z => ({ ...z, code: z.code.trim().toUpperCase(), nameFr: z.nameFr.trim(), nameAr: z.nameAr.trim() })),
  };
  if (new Set(config.zones.map(z => z.code)).size !== config.zones.length || config.zones.some(z => !z.nameFr || !z.nameAr)) fail("Codes de zone uniques et noms bilingues obligatoires.", 400);
  const defaults = wilayaDefaults();
  if (config.zones.length !== 58 || defaults.some(w => !config.zones.some(z => z.code === w.code))) fail("La table doit contenir les 58 wilayas, de 01 à 58.", 400);
  config.zones = defaults.map(w => {
    const z = config.zones.find(row => row.code === w.code)!;
    if (z.enabled) {
      if (z.homeFeeMinor === null && z.deskFeeMinor === null) fail(`Renseignez au moins un tarif pour la wilaya ${z.code}.`, 400);
      for (const mode of ["home", "desk"] as const) {
        const fee = z[`${mode}FeeMinor`], min = z[`${mode}MinDays`], max = z[`${mode}MaxDays`];
        if (fee !== null && (min === null || max === null || min > max)) fail(`Délai minimal et maximal requis pour ${z.code} (${mode}).`, 400);
      }
    }
    return { ...z, nameFr: w.nameFr, nameAr: w.nameAr };
  });
  if (config.enabled) {
    if (!config.deliveryEnabled && !config.pickupEnabled) fail("Activez au moins un mode de réception.", 400);
    if (!config.reservationMinutes || config.policyFr.length < 10 || config.policyAr.length < 10) fail("Durée de réservation et conditions bilingues obligatoires avant activation.", 400);
    if (config.pickupEnabled && (!config.pickupAddressFr || !config.pickupAddressAr || config.pickupFeeMinor === null)) fail("Adresse de retrait bilingue et frais confirmés obligatoires.", 400);
    if (config.deliveryEnabled && !config.zones.some(z => z.enabled)) fail("Configurez au moins une zone de livraison et son tarif.", 400);
  }
  await lockCheckout(tx);
  await tx.storeSetting.upsert({ where: { key: "checkout.config" }, create: { key: "checkout.config", value: JSON.stringify(config) }, update: { value: JSON.stringify(config) } });
  await tx.auditLog.create({ data: { userId: actor.id, action: "CHECKOUT_SETTINGS_UPDATED", detail: `Vente en ligne ${config.enabled ? "activée" : "désactivée"}. Les commandes existantes conservent leurs tarifs et conditions.` } });
  return config;
}
