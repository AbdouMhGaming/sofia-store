import { randomBytes, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { db } from "@workspace/db";
import { hashPassword } from "../src/lib/security";

const suffix = randomUUID().slice(0, 8);
const email = `verification-${suffix}@invalid.test`;
const password = randomBytes(24).toString("base64url");
const passwordHash = await hashPassword(password);
try {
  const user = await db.$transaction(async tx => {
    const role = await tx.role.findUniqueOrThrow({ where: { name: "MANAGER" } });
    return tx.user.create({ data: { email, passwordHash, mustChangePassword: false, roles: { create: { roleId: role.id } } } });
  });
  await writeFile("/tmp/sofia-catalog-browser-check.json", JSON.stringify({
    email, password, userId: user.id, prefix: `verification-${suffix}`,
    barcode: BigInt("0x" + randomBytes(6).toString("hex")).toString(),
  }), { mode: 0o600 });
  console.log("Temporary verification manager prepared; credentials stored privately outside the project.");
} finally { await db.$disconnect(); }
