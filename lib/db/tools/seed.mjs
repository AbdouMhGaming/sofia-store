import { PrismaClient } from "@prisma/client";
for (const key of ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASS"]) {
  if (!process.env[key]) throw new Error(`Missing ${key}`);
}
const url = `mysql://${encodeURIComponent(process.env.DB_USER)}:${encodeURIComponent(process.env.DB_PASS)}@${process.env.DB_HOST}:${process.env.DB_PORT || 3306}/${encodeURIComponent(process.env.DB_NAME)}?sslaccept=strict`;
const db = new PrismaClient({ datasources: { db: { url } }, log: [] });
try {
  await db.$transaction(async tx => {
    for (const name of ["STORE_OWNER", "MANAGER", "CASHIER"]) {
      await tx.role.upsert({ where: { name }, update: {}, create: { name } });
    }
    await tx.location.upsert({ where: { code: "STORE" }, update: {}, create: { code: "STORE", name: "Boutique SOFIA STORE" } });
    const categories = [
      { slug: "robes-brodees", nameFr: "Robes brodées", nameAr: "فساتين مطرزة" },
      { slug: "tenues-de-fete", nameFr: "Tenues de fête", nameAr: "أزياء المناسبات" },
      { slug: "abayas", nameFr: "Abayas", nameAr: "عبايات" },
    ];
    for (const category of categories) {
      await tx.category.upsert({ where: { slug: category.slug }, update: {}, create: category });
    }
    const category = await tx.category.findUniqueOrThrow({ where: { slug: "robes-brodees" } });
    // Descriptive labels for supplied photographs, not verified commercial listings.
    // No prices, sizes, barcodes, stock, sales, customers, or testimonials are invented.
    const previews = [
      ["emeraude", "Émeraude", "زمردي"],
      ["champagne", "Champagne", "شامبانيا"],
      ["rose-poudre", "Rose poudré", "وردي"],
      ["ivoire", "Ivoire", "عاجي"],
      ["noir", "Noir", "أسود"],
      ["cuivre", "Cuivre", "نحاسي"],
    ];
    for (const [index, [slug, colorFr, colorAr]] of previews.entries()) {
      await tx.product.upsert({
        where: { slug: `apercu-robe-${slug}` }, update: {},
        create: {
          slug: `apercu-robe-${slug}`, nameFr: `Robe brodée · ${colorFr}`, nameAr: `فستان مطرز · ${colorAr}`,
          descriptionFr: "Aperçu issu d'une photographie fournie par SOFIA STORE. Le nom est descriptif et provisoire. Prix, tailles, composition et disponibilité à confirmer auprès de la boutique avant publication commerciale.",
          descriptionAr: "معاينة من صورة قدمها متجر صوفيا. الاسم وصفي ومؤقت. يجب تأكيد السعر والمقاسات والخامة والتوفر لدى المتجر قبل طرح المنتج للبيع.",
          categoryId: category.id, status: "PREVIEW", featured: index < 4,
          images: { create: { path: `/products/dress-${index + 1}.jpeg`, position: 0 } },
        },
      });
    }
    await tx.storeSetting.upsert({ where: { key: "commerce_enabled" }, update: {}, create: { key: "commerce_enabled", value: "false" } });
  }, { maxWait: 5000, timeout: 60000 });
  console.log("Seed complete: roles, location, categories, and six explicitly marked photo previews. No owner, prices, or stock created.");
} catch (error) {
  console.error("Seed failed.", typeof error?.code === "string" ? error.code : "DATABASE_ERROR");
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
