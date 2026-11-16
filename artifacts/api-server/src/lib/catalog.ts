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
export function validImages(images: string[]) {
  return images.every(path => /^\/products\/dress-[1-6]\.jpeg$/.test(path));
}
