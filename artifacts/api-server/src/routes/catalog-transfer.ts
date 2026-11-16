import { Router, type IRouter } from "express";
import { db, catalogHeaders, csvCell, transferCatalog } from "@workspace/db";
import { ImportCatalogBody, ImportCatalogResponse } from "@workspace/api-zod";
import type { Identity } from "../lib/security";

const router: IRouter = Router();
router.get("/admin/catalog/export", async (_req, res): Promise<void> => {
  const products = await db.product.findMany({
    orderBy: { id: "asc" }, take: 10001,
    include: { category: true, images: { orderBy: { position: "asc" }, take: 1 }, variants: { include: { size: true, color: true } } },
  });
  if (products.length > 10000) { res.status(413).json({ error: "Le catalogue dépasse la limite d'export de 10 000 produits. Un export paginé est nécessaire ; aucun fichier incomplet n'a été généré." }); return; }
  const lines = [catalogHeaders.join(",")];
  for (const p of products) {
    for (const v of p.variants.length ? p.variants : [null]) {
      lines.push([p.slug, p.nameFr, p.nameAr, p.descriptionFr, p.descriptionAr, p.category.slug, p.images[0]?.path || "", v?.sku || "", v?.barcode || "", v?.size.name || "", v?.color.name || "", v?.priceMinor ?? "", v?.costMinor ?? ""].map(csvCell).join(","));
    }
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="sofia-catalogue.csv"');
  res.send("\uFEFF" + lines.join("\r\n"));
});
router.post("/admin/catalog/import", async (req, res): Promise<void> => {
  const input = ImportCatalogBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Import invalide. Maximum 200 000 caractères, avec référence de requête." }); return; }
  const userId = (res.locals.identity as Identity).user.id;
  const result = await db.$transaction(tx => transferCatalog(tx, input.data, userId), { timeout: 60000, maxWait: 5000 });
  res.json(ImportCatalogResponse.parse(result));
});
export default router;
