import type { RetailReport, ReportActivity, ReportMoney, ReportMerchandiseGroup } from "@workspace/api-zod";
import { createHash } from "node:crypto";
import type { ReportSource } from "./load";
import { activity, add, bucket, CHANNELS, DAY, derive, exact, finish, invariant, localDate, multiply, selected, sum, within, type Channel, type ReportOptions } from "./primitives";

export function aggregateRetailReport(source: ReportSource, o: ReportOptions, now = new Date()): RetailReport {
  const summary = bucket("TOTAL", "Total de la période");
  const periods = new Map<string, ReturnType<typeof bucket>>(), channels = new Map<string, ReturnType<typeof bucket>>();
  const products = new Map<string, ReportMerchandiseGroup>(), categories = new Map<string, ReportMerchandiseGroup>();
  const periodKey = (d: Date) => localDate(d).slice(0, o.groupBy === "MONTH" ? 7 : 10);
  for (let t = o.start.getTime(); t < o.end.getTime(); t += DAY) {
    const key = periodKey(new Date(t)); if (!periods.has(key)) periods.set(key, bucket(key, key));
  }
  for (const [key, label] of Object.entries(CHANNELS)) if (selected(o, key as Channel)) channels.set(key, bucket(key, label));
  const targets = (date: Date, channel: Channel) => {
    invariant(within(date, o) && selected(o, channel));
    return [summary, periods.get(periodKey(date))!, channels.get(channel)!];
  };
  const group = (map: Map<string, ReportMerchandiseGroup>, key: string, label: string) => {
    if (!map.has(key)) map.set(key, { key, label, activity: activity() }); return map.get(key)!;
  };
  type Variant = ReportSource["sales"][number]["items"][number]["variant"];
  const item = (date: Date, channel: Channel, variant: Variant, delta: Partial<ReportActivity>) => {
    for (const b of targets(date, channel)) add(b.activity, delta);
    const p = variant.product;
    add(group(products, String(p.id), p.nameFr).activity, delta);
    add(group(categories, String(p.categoryId), p.category.nameFr).activity, delta);
  };
  const funds = (date: Date, channel: Channel, delta: Partial<ReportMoney>) => {
    for (const b of targets(date, channel)) add(b.money, delta);
  };
  const saleCount = (date: Date, channel: Channel) => { for (const b of targets(date, channel)) b.salesCount = sum(b.salesCount, 1); };
  for (const sale of source.sales) {
    invariant(sale.payment?.method === "CASH" && sale.payment.amountMinor === sale.totalMinor);
    invariant(sum(...sale.items.map(i => i.lineTotalMinor)) === sale.totalMinor);
    invariant(sum(...sale.items.map(i => i.discountMinor)) === sale.discountMinor);
    invariant(sum(...sale.items.map(i => multiply(i.unitPriceMinor, i.quantity))) === sale.subtotalMinor);
    saleCount(sale.createdAt, "POS");
    for (const l of sale.items) {
      invariant(sum(multiply(l.unitPriceMinor, l.quantity), -l.discountMinor) === l.lineTotalMinor);
      item(sale.createdAt, "POS", l.variant, { unitsSold: l.quantity, grossMinor: multiply(l.unitPriceMinor, l.quantity), discountMinor: l.discountMinor, costSoldMinor: multiply(l.unitCostMinor, l.quantity) });
    }
    funds(sale.createdAt, "POS", { cashInMinor: sale.payment.amountMinor });
  }
  for (const refund of source.refunds) {
    invariant(sum(...refund.items.map(i => i.amountMinor)) === refund.amountMinor);
    for (const l of refund.items) item(refund.createdAt, "POS", l.saleItem.variant, {
      unitsReturned: l.quantity, returnsMinor: l.amountMinor, costRecoveredMinor: l.restock ? multiply(l.saleItem.unitCostMinor, l.quantity) : 0,
    });
    funds(refund.createdAt, "POS", { cashOutMinor: refund.amountMinor, merchandiseRefundsMinor: refund.amountMinor });
  }
  const seen = new Set<string>(), returned = new Map(source.returnedStock.map(m => [m.requestId, m]));
  for (const event of source.events) {
    const order = event.order, c = order.fulfillment as Channel;
    invariant(c === "PICKUP" || c === "DELIVERY");
    const recognized = order.events.filter(e => (c === "DELIVERY" ? e.kind === "DELIVER" : e.kind === "RECEIPT") && e.createdAt <= event.createdAt);
    invariant(recognized.length <= 1);
    const isSale = c === "DELIVERY" ? event.kind === "DELIVER" : event.kind === "RECEIPT";
    if (isSale || event.kind === "RETURN_RECEIVE") {
      const key = `${order.id}:${isSale ? "SALE" : "RETURN"}`;
      invariant(!seen.has(key)); seen.add(key);
      invariant(sum(...order.items.map(i => i.lineTotalMinor)) === order.subtotalMinor);
      if (isSale) saleCount(event.createdAt, c);
      for (const l of order.items) {
        invariant(multiply(l.unitPriceMinor, l.quantity) === l.lineTotalMinor);
        const cost = multiply(l.unitCostMinor, l.quantity);
        if (isSale) item(event.createdAt, c, l.variant, { unitsSold: l.quantity, grossMinor: l.lineTotalMinor, costSoldMinor: cost });
        else {
          const movement = returned.get(`WEB-RETURN-${order.id}-${l.variantId}`);
          if (movement) invariant(movement.kind === "WEB_RETURN" && movement.variantId === l.variantId && movement.quantity === l.quantity);
          item(event.createdAt, c, l.variant, recognized.length ? {
            unitsReturned: l.quantity, returnsMinor: l.lineTotalMinor, costRecoveredMinor: movement ? cost : 0,
          } : { damagedUnfulfilledMinor: movement ? 0 : cost });
        }
      }
    }
  }
  for (const p of source.payments) {
    const c = p.order.fulfillment as Channel;
    invariant(["PICKUP", "DELIVERY"].includes(c) && ["CASH", "BANK"].includes(p.method));
    if (p.kind === "RECEIPT") {
      invariant(sum(p.amountMinor, p.feeMinor) === p.order.totalMinor);
      funds(p.createdAt, c, { [p.method === "CASH" ? "cashInMinor" : "bankInMinor"]: p.amountMinor, shippingInMinor: p.order.feeMinor, carrierFeesMinor: p.feeMinor });
    } else {
      invariant(p.kind === "REFUND" && p.feeMinor === 0 && sum(p.order.subtotalMinor, p.feeRefundMinor) === p.amountMinor);
      funds(p.createdAt, c, { [p.method === "CASH" ? "cashOutMinor" : "bankOutMinor"]: p.amountMinor, merchandiseRefundsMinor: p.order.subtotalMinor, shippingRefundsMinor: p.feeRefundMinor });
    }
  }
  for (const b of [summary, ...periods.values(), ...channels.values()]) finish(b);
  const groups = (map: Map<string, ReportMerchandiseGroup>) => [...map.values()].map(g => { derive(g.activity); return g; })
    .filter(g => Object.values(g.activity).some(n => n !== 0)).sort((a, b) => b.activity.netMinor - a.activity.netMinor || a.key.localeCompare(b.key));
  const report: RetailReport = {
    fingerprint: "",
    from: o.from, to: o.to, groupBy: o.groupBy, channel: o.channel, timezone: "Africa/Algiers", generatedAt: now,
    summary, periods: [...periods.values()], channels: [...channels.values()], products: groups(products), categories: groups(categories),
    outstanding: { count: exact(source.outstanding._count.id), grossMinor: exact(source.outstanding._sum.totalMinor ?? 0), asOf: o.asOf },
    definitions: [
      { key: "dates", label: "Dates et limite", explanation: "Dates inclusives, de 2000 à aujourd'hui, 366 jours maximum ; calendrier d'Alger (UTC+1 sur cette période). Les flux d'aujourd'hui et le solde transporteur ont le même instant d'arrêt. Une limite de volume provoque un refus explicite, jamais un rapport tronqué." },
      { key: "activity", label: "Activité marchandise", explanation: "Caisse : vente à sa date d'origine, même remboursée ensuite. Livraison : événement de livraison au client, pas expédition. Retrait : remise/encaissement. Une livraison peut être impayée : ce n'est pas une recette boutique." },
      { key: "returns", label: "Retours physiques et remboursements distincts", explanation: "La marchandise est déduite à la réception du retour complet en ligne, ou à la date du retour caisse. Le remboursement financier est affiché à sa propre date, sans déduire deux fois la marchandise. Un retour non encore remboursé n'est pas de l'argent rendu." },
      { key: "costs", label: "Coûts historiques", explanation: "Coûts et remises enregistrés sur les lignes originales. Seules les unités réellement remises en stock annulent leur coût. Les articles endommagés restent une charge. Un envoi jamais livré et revenu endommagé est une perte à sa réception." },
      { key: "money", label: "Recettes réelles", explanation: "Espèces/banque : montants nets effectivement enregistrés, moins remboursements à leur date. Un encaissement transporteur n'est pas un encaissement boutique. Les frais de livraison encaissés et retenues réelles sont datés au reversement boutique." },
      { key: "margin", label: "Marge estimée, pas bénéfice net", explanation: "Marge marchandise = net des retours physiques moins coût net. Estimation globale = marge marchandise + frais de livraison encaissés − frais remboursés − retenues transporteur enregistrées. Dates d'activité et de trésorerie différentes ; charges fixes, fiscalité et frais non encore connus exclus." },
      { key: "groups", label: "Classification actuelle", explanation: "Noms produits et catégories actuels du catalogue, pas une catégorie historique inventée. Les montants utilisent toujours les prix/coûts figés. Les groupes articles se rapprochent des totaux marchandise ; livraison/retenues restent des ajustements de commande séparés." },
      { key: "outstanding", label: "Solde transporteur à date", explanation: "Total client collecté et non encore reversé à la fin choisie (ou maintenant pour aujourd'hui), y compris commandes antérieures au début. Ce n'est pas un flux de période. Un remboursement payé par la boutique n'efface pas la dette du transporteur." },
    ],
    warnings: [
      "Rapport opérationnel non fiscal. Aucun tarif transporteur, impôt ou coût historique manquant n'est estimé automatiquement.",
      "Les sommes peuvent être négatives sur une période de retours ou de remboursements. Un revenu commercial n'est pas nécessairement payé.",
      "Les remises en stock créditent le coût à la date du retour physique, indépendamment de la date du remboursement.",
      ...(source.sales.some(s => s.items.some(i => i.unitCostMinor === 0)) || source.refunds.some(r => r.items.some(i => i.saleItem.unitCostMinor === 0))
        || source.events.some(e => e.order.items.some(i => i.unitCostMinor === 0))
        ? ["Coût enregistré nul sur au moins une ligne : il reste nul dans l'estimation ; vérifiez qu'il est intentionnel. Aucun coût actuel ne le remplace."] : []),
    ],
  };
  // Compare result values, not clocks: a later export may proceed only if its
  // complete financial/classification result still matches the displayed one.
  const { generatedAt: _generated, outstanding, fingerprint: _fingerprint, ...stable } = report;
  report.fingerprint = createHash("sha256").update(JSON.stringify({ ...stable,
    outstanding: { count: outstanding.count, grossMinor: outstanding.grossMinor },
  })).digest("hex");
  return report;
}
