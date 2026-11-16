import { readFile, unlink } from "node:fs/promises";
import { db } from "@workspace/db";

const path = "/tmp/sofia-catalog-browser-check.json";
const fixture = JSON.parse(await readFile(path, "utf8")) as { userId: number; prefix: string };
if (!/^verification-[a-f0-9]{8}$/.test(fixture.prefix)) throw new Error("Invalid verification fixture");
try {
  await db.$transaction(async tx => {
    // Only zero-stock, unmoved products created under the exact verification prefix.
    const products = await tx.product.findMany({ where: { slug: { startsWith: fixture.prefix + "-" } }, include: { variants: { include: { inventory: true, movements: true } } } });
    for (const p of products) {
      if (p.variants.some(v => v.movements.length || v.inventory.some(i => i.onHand !== 0 || i.reserved !== 0))) throw new Error("Verification product has stock activity; automatic cleanup refused");
      const ids = p.variants.map(v => v.id);
      await tx.productImage.deleteMany({ where: { productId: p.id } });
      await tx.inventory.deleteMany({ where: { variantId: { in: ids } } });
      await tx.productVariant.deleteMany({ where: { id: { in: ids } } });
      await tx.product.delete({ where: { id: p.id } });
    }
    const categories = await tx.category.findMany({ where: { slug: { startsWith: fixture.prefix + "-" } } });
    for (const category of categories) if (await tx.product.count({ where: { categoryId: category.id } }) === 0) await tx.category.delete({ where: { id: category.id } });
    const sizes = await tx.size.findMany({ where: { name: { startsWith: fixture.prefix + "-" } } });
    for (const size of sizes) if (await tx.productVariant.count({ where: { sizeId: size.id } }) === 0) await tx.size.delete({ where: { id: size.id } });
    const colors = await tx.color.findMany({ where: { name: { startsWith: fixture.prefix + "-" } } });
    for (const color of colors) if (await tx.productVariant.count({ where: { colorId: color.id } }) === 0) await tx.color.delete({ where: { id: color.id } });
    await tx.session.deleteMany({ where: { userId: fixture.userId } });
    await tx.user.update({ where: { id: fixture.userId }, data: { active: false } });
    await tx.auditLog.create({ data: { userId: fixture.userId, action: "VERIFICATION_CLEANED", detail: "Vérification du catalogue terminée. Compte désactivé et produits temporaires sans stock retirés." } });
  }, { timeout: 60000 });
  await unlink(path);
  console.log("Verification manager disabled, sessions revoked, zero-stock test products removed; audit preserved.");
} finally { await db.$disconnect(); }
