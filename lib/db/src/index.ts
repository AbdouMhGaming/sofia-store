import { PrismaClient, Prisma as PrismaRuntime } from "@prisma/client";

export function mysqlUrl(): string {
  for (const key of ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASS"]) {
    if (!process.env[key]) throw new Error(`Missing required database secret: ${key}`);
  }
  const port = Number(process.env.DB_PORT || "3306");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid DB_PORT");
  return `mysql://${encodeURIComponent(process.env.DB_USER!)}:${encodeURIComponent(process.env.DB_PASS!)}@${process.env.DB_HOST}:${port}/${encodeURIComponent(process.env.DB_NAME!)}?sslaccept=strict&connection_limit=5&connect_timeout=10`;
}

export const db = new PrismaClient({
  datasources: { db: { url: mysqlUrl() } },
  transactionOptions: { maxWait: 5000, timeout: 30000 },
  log: [],
});
/** Locking reads must not be followed by an older MySQL repeatable-read snapshot. */
export function posTransaction<T>(work: (tx: PrismaRuntime.TransactionClient) => Promise<T>) {
  return db.$transaction(work, { timeout: 60000, maxWait: 10000, isolationLevel: PrismaRuntime.TransactionIsolationLevel.ReadCommitted });
}
export { Prisma } from "@prisma/client";
export { applyStockAdjustment } from "./stock";
export { transferCatalog, parseCatalogCsv, csvCell, catalogHeaders } from "./catalog-transfer";
export { openDrawer, closeDrawer, saveReceiptSettings } from "./pos/registers";
export { recordCashSale, allocateDiscount } from "./pos/sales";
export { recordRefund, refundAmount } from "./pos/refunds";
export { cancelSaleAttempt, cancelRefundAttempt, cancelRegisterAttempt } from "./pos/cancellation";
export { receiptSettings, registerOutput, registerOutputs, drawerTotals, readSale, saleInclude, saleOutput, manager as posManager, type PosActor } from "./pos/shared";
export { checkoutSettings, publishCheckoutSettings, disabledCheckout, lockCheckout, webOrderInclude, webOrderOutput, adminWebOrderOutput, readWebOrder } from "./checkout/shared";
export { saveCheckoutSettings } from "./checkout/settings";
export { buildCheckoutQuote } from "./checkout/quote";
export { placeWebOrder, recoverWebOrder, abandonWebOrderRequest } from "./checkout/orders";
export { expireCheckoutOrders, cancelWebOrder } from "./checkout/lifecycle";
export { actOnWebOrder } from "./checkout/fulfillment";
export { recordWebPayment } from "./checkout/payments";
export { recoverWebCommand, abandonWebCommand } from "./checkout/commands";
