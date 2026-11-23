import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { fail } from "./pos/shared";

export async function lockAccount(tx: Prisma.TransactionClient, id: number) {
  if (!Number.isSafeInteger(id) || id < 1 || id > 2147483647 || !await tx.user.findUnique({ where: { id }, select: { id: true } })) fail("Compte introuvable.", 404);
  // Separate sentinel avoids holding an exclusive users-parent lock while
  // waiting for a drawer. Financial audit FKs take shared parent locks.
  await tx.$executeRaw`INSERT INTO account_guards (userId) VALUES (${id}) ON DUPLICATE KEY UPDATE userId = VALUES(userId)`;
  await tx.$queryRaw`SELECT userId FROM account_guards WHERE userId = ${id} FOR UPDATE`;
  return tx.user.findUniqueOrThrow({ where: { id }, include: { roles: { include: { role: true } } } });
}
export function accountRole(user: { roles: { role: { name: string } }[] }) {
  const names = user.roles.map(r => r.role.name);
  return names.includes("STORE_OWNER") ? "STORE_OWNER" : names.includes("MANAGER") ? "MANAGER" : names.includes("CASHIER") ? "CASHIER" : null;
}
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
    (error, key) => error ? reject(error) : resolve(key)));
}
export async function hashStaffPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$32768$${salt}$${(await derive(password, salt)).toString("hex")}`;
}
export async function verifyStaffPassword(password: string, stored: string) {
  const [algorithm, n, salt, expected] = stored.split("$");
  if (algorithm !== "scrypt" || n !== "32768" || !salt || !expected || !/^[a-f0-9]{128}$/.test(expected)) return false;
  const actual = await derive(password, salt), wanted = Buffer.from(expected, "hex");
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}
