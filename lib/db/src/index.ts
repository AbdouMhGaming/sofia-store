import { PrismaClient } from "@prisma/client";

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
export { Prisma } from "@prisma/client";
export { applyStockAdjustment } from "./stock";
