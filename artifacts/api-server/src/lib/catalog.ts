import { Prisma } from "@workspace/db";

export const productInclude = {
  category: true,
  images: { orderBy: { position: "asc" as const } },
  variants: { include: { size: true, color: true, inventory: true } },
} satisfies Prisma.ProductInclude;
type FullProduct = Prisma.ProductGetPayload<{ include: typeof productInclude }>;
export function publicProduct(p: FullProduct) {
  return {
    id: p.id, slug: p.slug, nameFr: p.nameFr, nameAr: p.nameAr,
    descriptionFr: p.descriptionFr, descriptionAr: p.descriptionAr,
    category: p.category, featured: p.featured, status: p.status,
    images: p.images.map(i => i.path),
    variants: p.variants.map(v => ({
      id: v.id, sku: v.sku, barcode: v.barcode, size: v.size.name, color: v.color.name, priceMinor: v.priceMinor,
      available: v.inventory.reduce((n, i) => n + i.onHand - i.reserved, 0),
    })),
  };
}
export async function prepareImages(tx: Prisma.TransactionClient, images: string[]) {
  if (new Set(images).size !== images.length) throw Object.assign(new Error("Une image ne peut apparaître qu'une fois."), { status: 400 });
  const mediaIds = images.filter(p => !/^\/products\/dress-[1-6]\.jpeg$/.test(p)).map(path => {
    const match = /^\/api\/media\/([a-f0-9-]{36})\/image$/.exec(path);
    if (!match) throw Object.assign(new Error("Chemin d'image invalide."), { status: 400 });
    return match[1]!;
  });
  // Lock in consistent order: a library deletion cannot race image attachment.
  for (const id of [...mediaIds].sort()) {
    const rows = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM media_assets WHERE id = ${id} FOR UPDATE`;
    if (rows[0]?.status !== "READY") throw Object.assign(new Error("Une image n'est plus disponible. Actualisez la photothèque."), { status: 409 });
  }
  return images.map((path, position) => ({ path, position, mediaId: path.startsWith("/api/media/") ? path.split("/")[3]! : null }));
}
