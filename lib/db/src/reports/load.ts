import type { Prisma } from "@prisma/client";
import { invariant, MAX_LINES, MAX_ROWS, reportFail, type ReportOptions } from "./primitives";

const product = { select: { product: { select: { id: true, nameFr: true, categoryId: true, category: { select: { nameFr: true } } } } } } as const;
const line = { variantId: true, quantity: true, unitPriceMinor: true, unitCostMinor: true, lineTotalMinor: true, variant: product } as const;
const webOrder = { select: { id: true, fulfillment: true, subtotalMinor: true, items: { select: line },
  events: { where: { kind: { in: ["DELIVER", "RECEIPT"] } }, select: { kind: true, createdAt: true } } } } satisfies Prisma.WebOrderDefaultArgs;
/** All reads share one non-locking snapshot; no financial write or drawer lock. */
export async function loadRetailReportSource(tx: Prisma.TransactionClient, o: ReportOptions) {
  const range = { gte: o.start, lte: o.asOf };
  const pos = o.channel === "ALL" || o.channel === "POS", web = o.channel !== "POS";
  const fulfillment = ["PICKUP", "DELIVERY"].includes(o.channel) ? o.channel : undefined;
  const sales = pos ? await tx.sale.findMany({ where: { createdAt: range }, select: { id: true, createdAt: true, subtotalMinor: true, discountMinor: true, totalMinor: true,
    payment: { select: { method: true, amountMinor: true } }, items: { select: { ...line, discountMinor: true } } }, take: MAX_ROWS + 1 }) : [];
  const refunds = pos ? await tx.refund.findMany({ where: { createdAt: range }, select: { createdAt: true, amountMinor: true, items: { select: {
    quantity: true, restock: true, amountMinor: true, saleItem: { select: { unitCostMinor: true, variant: product } },
  } } }, take: MAX_ROWS + 1 }) : [];
  const events = web ? await tx.webOrderEvent.findMany({
    where: { createdAt: range, kind: { in: ["DELIVER", "RECEIPT", "RETURN_RECEIVE"] }, order: { fulfillment } },
    select: { id: true, orderId: true, kind: true, createdAt: true, order: webOrder }, take: MAX_ROWS + 1,
  }) : [];
  const payments = web ? await tx.webOrderPayment.findMany({
    where: { createdAt: range, order: { fulfillment } }, select: { orderId: true, kind: true, method: true, amountMinor: true, feeMinor: true, feeRefundMinor: true,
      createdAt: true, order: { select: { fulfillment: true, totalMinor: true, subtotalMinor: true, feeMinor: true } } }, take: MAX_ROWS + 1,
  }) : [];
  if ([sales, refunds, events, payments].some(rows => rows.length > MAX_ROWS)) reportFail("Plus de 5 000 opérations par source ; réduisez la période.", 413);
  const lines = sales.reduce((s, r) => s + r.items.length, 0) + refunds.reduce((s, r) => s + r.items.length, 0)
    + events.reduce((s, r) => s + r.order.items.length, 0);
  if (lines > MAX_LINES) reportFail("Plus de 20 000 lignes ; réduisez la période.", 413);
  const returnKeys = [...new Set(events.filter(e => e.kind === "RETURN_RECEIVE").flatMap(e => e.order.items.map(i => `WEB-RETURN-${e.orderId}-${i.variantId}`)))];
  const returnedStock = returnKeys.length ? await tx.stockMovement.findMany({ where: { requestId: { in: returnKeys } }, select: { requestId: true, quantity: true, variantId: true, kind: true } }) : [];
  const outstanding = web ? await tx.webOrder.aggregate({
    where: { fulfillment, events: { some: { kind: "COURIER_COLLECT", createdAt: { lte: o.asOf } } },
      payments: { none: { kind: "RECEIPT", createdAt: { lte: o.asOf } } } },
    _count: { id: true }, _sum: { totalMinor: true },
  }) : { _count: { id: 0 }, _sum: { totalMinor: 0 } };
  invariant(lines >= 0);
  return { sales, refunds, events, payments, returnedStock, outstanding };
}
export type ReportSource = Awaited<ReturnType<typeof loadRetailReportSource>>;
