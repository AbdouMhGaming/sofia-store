import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { db, Prisma, reportOptions, aggregateRetailReport, loadRetailReportSource, readRetailReport, retailReportCsv, reportCsvCell } from "../src/index";
import { selected, within, exact, sum, multiply, MAX_ROWS, MAX_LINES } from "../src/reports/primitives";
import type { ReportSource } from "../src/reports/load";
import type { RetailReport } from "@workspace/api-zod";

const now = new Date("2024-04-15T12:00:00Z"), at = (s: string) => new Date(s);
const variant = { product: { id: 900001, nameFr: '=TEST "article"', categoryId: 900001, category: { nameFr: "@TEST catégorie" } } };
const line = { variantId: 1, quantity: 2, unitPriceMinor: 200, unitCostMinor: 50, lineTotalMinor: 400, variant };
const delivered = { kind: "DELIVER", createdAt: at("2024-02-02T10:00:00Z") };
const delivery = { id: 2, fulfillment: "DELIVERY", subtotalMinor: 400, items: [line], events: [delivered] };
const failed = { id: 3, fulfillment: "DELIVERY", subtotalMinor: 300, items: [{ ...line, quantity: 1, unitPriceMinor: 300, unitCostMinor: 60, lineTotalMinor: 300 }], events: [] };
const pickupDate = at("2024-02-06T10:00:00Z");
const pickup = { id: 4, fulfillment: "PICKUP", subtotalMinor: 250, items: [{ ...line, unitPriceMinor: 125, lineTotalMinor: 250 }], events: [{ kind: "RECEIPT", createdAt: pickupDate }] };
const raw: ReportSource = {
  sales: [{ id: 1, createdAt: at("2024-01-31T22:59:59.999Z"), subtotalMinor: 303, discountMinor: 3, totalMinor: 300,
    payment: { method: "CASH", amountMinor: 300 }, items: [{ ...line, quantity: 3, unitPriceMinor: 101, unitCostMinor: 40, lineTotalMinor: 300, discountMinor: 3 }] }],
  refunds: [true, false].map((restock, i) => ({ createdAt: at(`2024-02-0${i + 1}T00:00:00Z`), amountMinor: 100, items: [{ quantity: 1, restock, amountMinor: 100, saleItem: { unitCostMinor: 40, variant } }] })),
  events: [
    { id: 1, orderId: 2, kind: "DELIVER", createdAt: delivered.createdAt, order: delivery },
    { id: 2, orderId: 2, kind: "RETURN_RECEIVE", createdAt: at("2024-02-03T10:00:00Z"), order: delivery },
    { id: 3, orderId: 3, kind: "RETURN_RECEIVE", createdAt: at("2024-02-05T10:00:00Z"), order: failed },
    { id: 4, orderId: 4, kind: "RECEIPT", createdAt: pickupDate, order: pickup },
  ],
  payments: [
    { orderId: 2, kind: "RECEIPT", method: "BANK", amountMinor: 470, feeMinor: 30, feeRefundMinor: 0, createdAt: at("2024-03-01T10:00:00Z"), order: { fulfillment: "DELIVERY", totalMinor: 500, subtotalMinor: 400, feeMinor: 100 } },
    { orderId: 2, kind: "REFUND", method: "CASH", amountMinor: 420, feeMinor: 0, feeRefundMinor: 20, createdAt: at("2024-02-10T10:00:00Z"), order: { fulfillment: "DELIVERY", totalMinor: 500, subtotalMinor: 400, feeMinor: 100 } },
    { orderId: 4, kind: "RECEIPT", method: "CASH", amountMinor: 275, feeMinor: 0, feeRefundMinor: 0, createdAt: pickupDate, order: { fulfillment: "PICKUP", totalMinor: 275, subtotalMinor: 250, feeMinor: 25 } },
  ],
  returnedStock: [{ requestId: "WEB-RETURN-2-1", quantity: 2, variantId: 1, kind: "WEB_RETURN" }],
  outstanding: { _count: { id: 0 }, _sum: { totalMinor: 0 } },
};
function calculate(from: string, to: string, channel: RetailReport["channel"] = "ALL", groupBy: RetailReport["groupBy"] = "DAY") {
  const o = reportOptions({ from, to, channel, groupBy }, now);
  const source: ReportSource = {
    sales: selected(o, "POS") ? raw.sales.filter(r => within(r.createdAt, o)) : [],
    refunds: selected(o, "POS") ? raw.refunds.filter(r => within(r.createdAt, o)) : [],
    events: raw.events.filter(r => selected(o, r.order.fulfillment as "PICKUP" | "DELIVERY") && within(r.createdAt, o)),
    payments: raw.payments.filter(r => selected(o, r.order.fulfillment as "PICKUP" | "DELIVERY") && within(r.createdAt, o)),
    returnedStock: raw.returnedStock, outstanding: { _count: { id: 0 }, _sum: { totalMinor: 0 } },
  };
  if (selected(o, "DELIVERY") && o.asOf >= delivered.createdAt && o.asOf < raw.payments[0]!.createdAt) source.outstanding = { _count: { id: 1 }, _sum: { totalMinor: 500 } };
  return aggregateRetailReport(source, o, now);
}
function reconcile(r: RetailReport) {
  for (const axis of [r.periods, r.channels]) {
    assert.equal(axis.reduce((s, v) => s + v.salesCount, 0), r.summary.salesCount);
    for (const key of Object.keys(r.summary.activity) as (keyof typeof r.summary.activity)[]) assert.equal(axis.reduce((s, v) => s + v.activity[key], 0), r.summary.activity[key]);
    for (const key of Object.keys(r.summary.money) as (keyof typeof r.summary.money)[]) assert.equal(axis.reduce((s, v) => s + v.money[key], 0), r.summary.money[key]);
    assert.equal(axis.reduce((s, v) => s + v.estimatedMarginMinor, 0), r.summary.estimatedMarginMinor);
  }
  for (const axis of [r.products, r.categories])
    for (const key of Object.keys(r.summary.activity) as (keyof typeof r.summary.activity)[]) assert.equal(axis.reduce((s, v) => s + v.activity[key], 0), r.summary.activity[key]);
}
function pureChecks() {
  const all = calculate("2024-01-01", "2024-03-31"), feb = calculate("2024-02-01", "2024-02-29"), march = calculate("2024-03-01", "2024-03-31");
  assert.equal(all.summary.activity.netMinor, 350); assert.equal(all.summary.activity.netCostMinor, 240);
  assert.equal(all.summary.money.netInMinor, 425); assert.equal(all.summary.money.netFeesMinor, 75);
  assert.equal(all.summary.estimatedMarginMinor, 185); assert.equal(all.summary.salesCount, 3);
  assert.equal(feb.summary.activity.netMinor, 50); assert.equal(feb.summary.activity.netCostMinor, 120);
  assert.equal(feb.summary.money.bankInMinor, 0); assert.equal(feb.summary.money.cashOutMinor, 620);
  assert.equal(feb.outstanding.grossMinor, 500, "Shop-funded refund does not clear courier receivable");
  assert.equal(march.summary.activity.netMinor, 0); assert.equal(march.summary.money.bankInMinor, 470);
  assert.equal(march.summary.money.netFeesMinor, 70); assert.equal(march.outstanding.grossMinor, 0);
  assert.match(all.fingerprint, /^[a-f0-9]{64}$/);
  assert.notEqual(all.fingerprint, feb.fingerprint, "Different results have different fingerprints");
  const o = reportOptions({ from: "2024-01-01", to: "2024-03-31" }, now);
  assert.equal(aggregateRetailReport(raw, o, at("2024-04-15T12:00:01Z")).fingerprint, all.fingerprint, "Clock-only changes do not invalidate exports");
  const returnsOnly = calculate("2024-02-01", "2024-02-01", "POS");
  assert.equal(returnsOnly.summary.activity.netMinor, -100); assert.equal(returnsOnly.summary.activity.costRecoveredMinor, 40);
  assert.equal(returnsOnly.summary.activity.marginMinor, -60);
  assert.equal(calculate("2024-02-02", "2024-02-02", "POS").summary.activity.costRecoveredMinor, 0, "Damaged return retains original cost");
  assert.equal(calculate("2024-02-05", "2024-02-05", "DELIVERY").summary.activity.damagedUnfulfilledMinor, 60, "Unfulfilled damaged shipment is a loss, not a sale");
  assert.equal(calculate("2024-01-31", "2024-01-31").summary.money.cashInMinor, 300, "Alger midnight boundary");
  for (const c of ["ALL", "POS", "ONLINE", "PICKUP", "DELIVERY"] as const) for (const grouping of ["DAY", "MONTH"] as const) reconcile(calculate("2024-01-01", "2024-03-31", c, grouping));
  Object.assign(variant, { priceMinor: 999999, costMinor: 999999 });
  assert.deepEqual(calculate("2024-01-01", "2024-03-31").summary, all.summary, "Current catalog prices/costs cannot change history");
  variant.product.category.nameFr = "Catégorie actuelle modifiée";
  assert.equal(calculate("2024-01-01", "2024-03-31").categories[0]!.label, variant.product.category.nameFr);
  const zero = calculate("2024-04-01", "2024-04-15");
  assert.equal(zero.products.length, 0); assert.equal(zero.summary.salesCount, 0); assert.equal(zero.summary.estimatedMarginMinor, 0);
  for (const bad of [{ from: "2024-02-30", to: "2024-03-01" }, { from: "2023-01-01", to: "2024-01-02" }, { from: "2024-04-16", to: "2024-04-16" }, { from: "2024-03-01", to: "2024-02-01" }, { from: "1999-12-01", to: "1999-12-31" }])
    assert.throws(() => reportOptions(bad, now), (e: unknown) => (e as { status: number }).status === 400);
  const leap = reportOptions({ from: "2024-01-01", to: "2024-12-31" }, at("2025-01-01T00:00:00Z")); assert.equal((leap.end.getTime() - leap.start.getTime()) / 86400000, 366);
  assert.equal(reportOptions({ from: "2024-04-15", to: "2024-04-15" }, now).asOf.getTime(), now.getTime());
  const csv = retailReportCsv(all);
  assert.ok(csv.startsWith("\uFEFF")); assert.ok(csv.includes('"activite.netMinor";"350";"centimes_DZD"'));
  assert.ok(csv.includes('"tresorerie.netInMinor";"425";"centimes_DZD"'));
  for (const s of ["=1+1", "+CMD", "-CMD", "@SUM(A1)", "\t =SUM(A1)", "\r\n=BAD"]) assert.ok(reportCsvCell(s).startsWith('"\''));
  assert.equal(reportCsvCell(-1), '"-1"'); assert.equal(reportCsvCell('a;"b'), '"a;""b"');
  assert.equal(sum(Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER), 0);
  for (const check of [() => exact(1.01), () => sum(Number.MAX_SAFE_INTEGER, 1), () => multiply(Number.MAX_SAFE_INTEGER, 2)])
    assert.throws(check, (e: unknown) => (e as { status: number }).status === 413);
  const bad = structuredClone(raw);
  bad.returnedStock[0]!.quantity = 1;
  assert.throws(() => aggregateRetailReport(bad, reportOptions({ from: "2024-01-01", to: "2024-03-31" }, now), now),
    (e: unknown) => (e as { status: number }).status === 409);
  console.log("PASS: exact discounts/costs, cross-month refunds/payouts, damaged/restocked returns, unpaid delivery vs money, courier debt after shop refund, all axes/channels, dates/leap bounds, empty/refund-only ranges and safe CSV.");
}

async function limitChecks() {
  const opts = reportOptions({ from: "2024-01-01", to: "2024-03-31" }, now);
  for (const sales of [Array(MAX_ROWS + 1).fill(raw.sales[0]), [{ ...raw.sales[0]!, items: Array(MAX_LINES + 1).fill(raw.sales[0]!.items[0]) }]]) {
    const fake = {
      sale: { findMany: async (args: { take: number; where: { createdAt: { lte: Date } } }) => {
        assert.equal(args.take, MAX_ROWS + 1); assert.equal(args.where.createdAt.lte, opts.asOf); return sales;
      } }, refund: { findMany: async () => [] }, webOrderEvent: { findMany: async () => [] }, webOrderPayment: { findMany: async () => [] },
    } as unknown as Prisma.TransactionClient;
    await assert.rejects(() => loadRetailReportSource(fake, opts), (e: unknown) => (e as { status: number }).status === 413);
  }
  console.log("PASS: integer overflow, malformed partial web restock, source row/expanded-line limits and consistent as-of cutoff fail explicitly instead of truncating.");
}

async function mysqlChecks() {
  const stop = new Error("ROLLBACK_REPORT_VERIFICATION");
  try {
    await db.$transaction(async tx => {
      const from = "2001-01-01", to = "2001-03-31";
      const opts = reportOptions({ from, to }, now), baseline = aggregateRetailReport(await loadRetailReportSource(tx, opts), opts, now);
      const suffix = randomUUID().slice(0, 8), hash = () => randomBytes(32).toString("hex");
      const user = await tx.user.create({ data: { email: `verify-reports-${suffix}@invalid.test`, active: false, passwordHash: "DISABLED_VERIFICATION_ONLY" } });
      const category = await tx.category.create({ data: { slug: `verify-reports-${suffix}`, nameFr: "=VÉRIFICATION", nameAr: "اختبار" } });
      const product = await tx.product.create({ data: { slug: `verify-reports-${suffix}`, nameFr: "VÉRIFICATION RAPPORT", nameAr: "اختبار", categoryId: category.id, status: "ARCHIVED", descriptionFr: "", descriptionAr: "" } });
      const size = await tx.size.create({ data: { name: `VR-${suffix}` } }), color = await tx.color.create({ data: { name: `VR-${suffix}` } });
      const v = await tx.productVariant.create({ data: { productId: product.id, sizeId: size.id, colorId: color.id, sku: `VR-${suffix}`, barcode: `00VR${suffix}`, priceMinor: 99999, costMinor: 99999 } });
      const reg = await tx.cashRegister.create({ data: { code: `VR-${suffix}`, name: "VÉRIFICATION" } });
      const session = await tx.registerSession.create({ data: { registerId: reg.id, openedById: user.id, closedById: user.id, status: "CLOSED", openingMinor: 0,
        openedAt: at("2001-01-31T10:00:00Z"), closedAt: at("2001-02-01T10:00:00Z"), expectedMinor: 100, countedMinor: 100, varianceMinor: 0, closeReason: "Vérification", openRequestId: randomUUID(), openRequestHash: hash() } });
      const sale = await tx.sale.create({ data: { number: `VR-${suffix}`, requestId: randomUUID(), requestHash: hash(), registerSessionId: session.id, userId: user.id, subtotalMinor: 202, discountMinor: 2, totalMinor: 200, storeName: "VÉRIFICATION", createdAt: at("2001-01-31T22:59:59.999Z"),
        items: { create: { variantId: v.id, productName: "VÉRIFICATION", nameAr: "اختبار", sku: v.sku, barcode: v.barcode, size: size.name, color: color.name, quantity: 2, unitPriceMinor: 101, unitCostMinor: 40, discountMinor: 2, lineTotalMinor: 200 } },
        payment: { create: { amountMinor: 200, tenderedMinor: 200, changeMinor: 0, createdAt: at("2001-01-31T22:59:59.999Z") } } }, include: { items: true } });
      await tx.refund.create({ data: { number: `VR-REM-${suffix}`, requestId: randomUUID(), requestHash: hash(), saleId: sale.id, registerSessionId: session.id, userId: user.id, kind: "RETURN", reason: "Vérification", amountMinor: 100, createdAt: at("2001-01-31T23:00:00Z"),
        items: { create: { saleItemId: sale.items[0]!.id, quantity: 1, restock: true, amountMinor: 100 } } } });
      const order = await tx.webOrder.create({ data: { reference: `VR-WEB-${suffix}`, requestId: randomUUID(), status: "RETURNED", fulfillment: "DELIVERY", collector: "COURIER", courierCollected: true,
        customerName: "Vérification uniquement", customerPhone: "0550000000", commune: "Vérification", address: "Vérification", notes: "", subtotalMinor: 400, feeMinor: 100, totalMinor: 500, snapshot: {}, createdAt: at("2001-01-30T00:00:00Z"), expiresAt: at("2001-01-31T00:00:00Z"),
        items: { create: { variantId: v.id, quantity: 2, unitPriceMinor: 200, unitCostMinor: 75, lineTotalMinor: 400 } },
        events: { create: [
          { kind: "DELIVER", reason: "Vérification", createdAt: at("2001-02-01T10:00:00Z") },
          { kind: "COURIER_COLLECT", reason: "Vérification", createdAt: at("2001-02-01T10:00:01Z") },
          { kind: "RETURN_RECEIVE", reason: "Vérification", createdAt: at("2001-02-02T10:00:00Z") },
        ] },
        payments: { create: [
          { userId: user.id, kind: "REFUND", method: "BANK", amountMinor: 400, feeMinor: 0, feeRefundMinor: 0, reference: "VR-REFUND", reason: "Vérification", receiptSettings: {}, createdAt: at("2001-02-03T10:00:00Z") },
          { userId: user.id, kind: "RECEIPT", method: "BANK", amountMinor: 470, feeMinor: 30, feeRefundMinor: 0, reference: "VR-RECEIPT", reason: "Vérification", receiptSettings: {}, createdAt: at("2001-03-01T10:00:00Z") },
        ] } } });
      await tx.stockMovement.create({ data: { variantId: v.id, userId: user.id, quantity: 2, kind: "WEB_RETURN", reason: "Vérification", requestId: `WEB-RETURN-${order.id}-${v.id}`, requestHash: hash(), balanceAfter: 2, createdAt: at("2001-02-02T09:59:59Z") } });
      const result = aggregateRetailReport(await loadRetailReportSource(tx, opts), opts, now);
      assert.equal(result.summary.activity.netMinor - baseline.summary.activity.netMinor, 100);
      assert.equal(result.summary.activity.netCostMinor - baseline.summary.activity.netCostMinor, 40);
      assert.equal(result.summary.money.netInMinor - baseline.summary.money.netInMinor, 170);
      assert.equal(result.summary.estimatedMarginMinor - baseline.summary.estimatedMarginMinor, 130);
      reconcile(result);
      const feb = reportOptions({ from: "2001-02-01", to: "2001-02-28", channel: "DELIVERY" }, now);
      const beforePayoutSource = await loadRetailReportSource(tx, feb);
      const beforePayout = aggregateRetailReport(beforePayoutSource, feb, now);
      assert.ok(beforePayout.outstanding.grossMinor >= 500);
      assert.equal(beforePayout.products.find(p => p.key === String(product.id))!.activity.costRecoveredMinor, 150);
      assert.equal(beforePayoutSource.payments.filter(p => p.orderId === order.id && p.kind === "RECEIPT").length, 0);
      const source = await loadRetailReportSource(tx, opts);
      assert.ok(!("customerPhone" in source.events.find(e => e.orderId === order.id)!.order), "Report query never loads customer details");
      throw stop;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 120000, maxWait: 10000 });
  } catch (e) { if (e !== stop) throw e; }
  console.log("PASS: actual MySQL loader, historical snapshots, midnight refunds, stock-movement restock lookup, courier as-of receivable and full-axis reconciliation. All owned fixtures rolled back; no live register or store setting touched.");
}
try {
  if (process.env.NODE_ENV === "production") throw new Error("Development verification only");
  pureChecks();
  await limitChecks();
  for (const role of ["MANAGER", "CASHIER"]) await assert.rejects(() => readRetailReport({ from: "2024-01-01", to: "2024-01-31" }, { role }), (e: unknown) => (e as { status: number }).status === 403);
  if (!process.argv.includes("--pure")) await mysqlChecks();
} catch (e) {
  console.error("Report verification failed:", (e as { code?: string }).code || (e as Error).name,
    (e as Error).name === "AssertionError" || (e as { status?: number }).status ? (e as Error).message : "");
  process.exitCode = 1;
} finally { await db.$disconnect(); }
