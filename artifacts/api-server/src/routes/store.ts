import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { GetProductParams, ListProductsQueryParams, ListProductsResponse, GetProductResponse } from "@workspace/api-zod";
import { productInclude, publicProduct } from "../lib/catalog";

const router: IRouter = Router();
router.get("/store", (_req, res) => {
  res.json({
    name: "SOFIA STORE", phone: "0792 01 34 53", location: "Relizane, Algérie",
    instagram: "https://instagram.com/sofia_store___",
    facebook: "https://www.facebook.com/share/1Gc7vDgDCL/?mibextid=wwXIfr",
    tiktok: "https://www.tiktok.com/@sofiastore01",
    commerceEnabled: false,
  });
});
router.get("/categories", async (_req, res): Promise<void> => {
  res.json(await db.category.findMany({ orderBy: { id: "asc" } }));
});
router.get("/products", async (req, res): Promise<void> => {
  const input = ListProductsQueryParams.safeParse(req.query);
  if (!input.success) { res.status(400).json({ error: "Recherche invalide." }); return; }
  const { search, category } = input.data;
  const products = await db.product.findMany({
    where: {
      status: { in: ["ACTIVE", "PREVIEW"] },
      ...(category ? { category: { slug: category } } : {}),
      ...(search ? { OR: [{ nameFr: { contains: search } }, { nameAr: { contains: search } }] } : {}),
    },
    include: productInclude,
    orderBy: [{ featured: "desc" }, { id: "asc" }], take: 200,
  });
  res.json(ListProductsResponse.parse(products.map(publicProduct)));
});
router.get("/products/:slug", async (req, res): Promise<void> => {
  const input = GetProductParams.safeParse(req.params);
  if (!input.success) { res.status(400).json({ error: "Produit invalide." }); return; }
  const product = await db.product.findFirst({ where: { slug: input.data.slug, status: { in: ["ACTIVE", "PREVIEW"] } }, include: productInclude });
  if (!product) { res.status(404).json({ error: "Produit introuvable." }); return; }
  res.json(GetProductResponse.parse(publicProduct(product)));
});
export default router;
