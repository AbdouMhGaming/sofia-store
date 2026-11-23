import type { GetRetailReportParams, RetailReport, ReportActivity, ReportMoney, ReportBucket } from "@workspace/api-zod";

export const DAY = 86_400_000, OFFSET = 3_600_000, MAX_ROWS = 5000, MAX_LINES = 20000;
export function reportFail(message: string, status = 400): never { throw Object.assign(new Error(message), { status }); }
export function reportOwner(actor: { role: string }) {
  if (actor.role !== "STORE_OWNER") reportFail("Rapports réservés au propriétaire.", 403);
}
export function exact(value: bigint | number): number {
  if (typeof value === "number" && !Number.isSafeInteger(value)) reportFail("Montant non entier ou trop élevé ; réduisez la période.", 413);
  const n = Number(value);
  if (!Number.isSafeInteger(n)) reportFail("Total trop élevé ; réduisez la période.", 413);
  return n;
}
export const sum = (...values: number[]) => exact(values.reduce((a, v) => a + BigInt(exact(v)), 0n));
export const multiply = (a: number, b: number) => exact(BigInt(exact(a)) * BigInt(exact(b)));
export function invariant(condition: unknown): asserts condition {
  if (!condition) reportFail("Historique financier incohérent ; rapport non généré.", 409);
}
export const localDate = (d: Date) => new Date(d.getTime() + OFFSET).toISOString().slice(0, 10);
export type ReportOptions = Pick<RetailReport, "from" | "to" | "groupBy" | "channel"> & { start: Date; end: Date; asOf: Date };
export function reportOptions(input: GetRetailReportParams, now = new Date()): ReportOptions {
  const parse = (s: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number(s.slice(0, 4)) < 2000) reportFail("Date invalide : choisissez une date à partir du 01/01/2000 (AAAA-MM-JJ).");
    const date = new Date(`${s}T00:00:00+01:00`);
    if (!Number.isFinite(date.getTime()) || localDate(date) !== s) reportFail("Date du calendrier invalide.");
    return date;
  };
  const start = parse(input.from), last = parse(input.to);
  if (last < start || (last.getTime() - start.getTime()) / DAY >= 366) reportFail("Choisissez une période de 1 à 366 jours.");
  if (input.to > localDate(now)) reportFail("La date de fin ne peut pas dépasser aujourd'hui (Alger).");
  const groupBy = input.groupBy ?? "DAY", channel = input.channel ?? "ALL";
  if (!["DAY", "MONTH"].includes(groupBy) || !["ALL", "POS", "ONLINE", "PICKUP", "DELIVERY"].includes(channel)) reportFail("Filtre invalide.");
  const end = new Date(last.getTime() + DAY);
  return { from: input.from, to: input.to, groupBy, channel, start, end, asOf: new Date(Math.min(end.getTime() - 1, now.getTime())) };
}
export const within = (d: Date, o: ReportOptions) => d >= o.start && d < o.end && d <= o.asOf;
export const activity = (): ReportActivity => ({ unitsSold: 0, unitsReturned: 0, grossMinor: 0, discountMinor: 0, returnsMinor: 0, netMinor: 0,
  costSoldMinor: 0, costRecoveredMinor: 0, damagedUnfulfilledMinor: 0, netCostMinor: 0, marginMinor: 0 });
export const money = (): ReportMoney => ({ cashInMinor: 0, bankInMinor: 0, cashOutMinor: 0, bankOutMinor: 0, netInMinor: 0,
  merchandiseRefundsMinor: 0, shippingInMinor: 0, shippingRefundsMinor: 0, carrierFeesMinor: 0, netFeesMinor: 0 });
export const bucket = (key: string, label: string): ReportBucket => ({ key, label, salesCount: 0, activity: activity(), money: money(), estimatedMarginMinor: 0 });
export const CHANNELS = { POS: "Caisse boutique", PICKUP: "Commande — retrait", DELIVERY: "Commande — livraison" } as const;
export type Channel = keyof typeof CHANNELS;
export const selected = (o: ReportOptions, c: Channel) => o.channel === "ALL" || o.channel === c || (o.channel === "ONLINE" && c !== "POS");
export function add<T extends object>(target: T, delta: Partial<T>) {
  for (const key of Object.keys(delta) as (keyof T)[]) target[key] = sum(target[key] as number, delta[key] as number) as T[keyof T];
}
export function derive(a: ReportActivity) {
  a.netMinor = sum(a.grossMinor, -a.discountMinor, -a.returnsMinor);
  a.netCostMinor = sum(a.costSoldMinor, -a.costRecoveredMinor, a.damagedUnfulfilledMinor);
  a.marginMinor = sum(a.netMinor, -a.netCostMinor);
}
export function finish(b: ReportBucket) {
  derive(b.activity);
  b.money.netInMinor = sum(b.money.cashInMinor, b.money.bankInMinor, -b.money.cashOutMinor, -b.money.bankOutMinor);
  b.money.netFeesMinor = sum(b.money.shippingInMinor, -b.money.shippingRefundsMinor, -b.money.carrierFeesMinor);
  b.estimatedMarginMinor = sum(b.activity.marginMinor, b.money.netFeesMinor);
}
