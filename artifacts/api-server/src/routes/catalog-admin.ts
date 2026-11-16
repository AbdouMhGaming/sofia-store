import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { CreateProductBody, UpdateProductBody, UpdateProductParams, CreateVariantBody, CreateVariantParams, ListAdminProductsResponse, CreateProductResponse, UpdateProductResponse, CreateVariantResponse } from "@workspace/api-zod";
import { type Identity } from "../lib/security";
import { productInclude, publicProduct, prepareImages } from "../lib/catalog";

const router: IRouter = Router();
router.get("/admin/products", async (_req, res): Promise<void> => {
  const products = await db.product.findMany({ include: productInclude, orderBy: { id: "desc" }, take: 500 });
  res.json(ListAdminProductsResponse.parse(products.map(p => ({ ...publicProduct(p), categoryId: p.categoryId }))));
});
router.post("/admin/products", async (req, res): Promise<void> => {
  const input = CreateProductBody.safeParse(req.body);
  if (!input.success || !input.data.nameFr.trim()) { res.status(400).json({ error: "Données du produit invalides." }); return; }
  if (input.data.status === "ACTIVE") { res.status(400).json({ error: "Créez d'abord le produit en aperçu, puis ajoutez ses variantes avant publication." }); return; }
  const userId = (res.locals.identity as Identity).user.id;
  const { images, ...data } = input.data;
  const slug = `${data.nameFr.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 140) || "mode"}-${randomUUID().slice(0, 8)}`;
  const product = await db.$transaction(async tx => {
    const imageData = await prepareImages(tx, images);
    const created = await tx.product.create({ data: { ...data, slug, images: { create: imageData } }, include: productInclude });
    await tx.auditLog.create({ data: { userId, action: "PRODUCT_CREATED", detail: `Produit créé : ${data.nameFr}` } });
    return created;
  });
  res.status(201).json(CreateProductResponse.parse({ ...publicProduct(product), categoryId: product.categoryId }));
});
router.put("/admin/products/:id", async (req, res): Promise<void> => {
  const params = UpdateProductParams.safeParse(req.params);
  const input = UpdateProductBody.safeParse(req.body);
  if (!params.success || !input.success || !input.data.nameFr.trim()) { res.status(400).json({ error: "Données du produit invalides." }); return; }
  const existing = await db.product.findUnique({ where: { id: params.data.id }, include: { variants: true } });
  if (!existing) { res.status(404).json({ error: "Produit introuvable." }); return; }
  if (input.data.status === "ACTIVE" && !existing.variants.length) { res.status(400).json({ error: "Ajoutez au moins une variante avec prix avant de publier." }); return; }
  const userId = (res.locals.identity as Identity).user.id;
  const { images, ...data } = input.data;
  const product = await db.$transaction(async tx => {
    const imageData = await prepareImages(tx, images);
    await tx.productImage.deleteMany({ where: { productId: existing.id } });
    const updated = await tx.product.update({
      where: { id: existing.id },
      data: { ...data, images: { create: imageData } },
      include: productInclude,
    });
    await tx.auditLog.create({ data: { userId, action: data.status === "ARCHIVED" ? "PRODUCT_ARCHIVED" : "PRODUCT_UPDATED", detail: `Produit : ${data.nameFr}` } });
    return updated;
  });
  res.json(UpdateProductResponse.parse({ ...publicProduct(product), categoryId: product.categoryId }));
});
router.post("/admin/products/:id/variants", async (req, res): Promise<void> => {
  const params = CreateVariantParams.safeParse(req.params);
  const input = CreateVariantBody.safeParse(req.body);
  if (!params.success || !input.success) { res.status(400).json({ error: "Variante invalide. Prix et coût doivent être en centimes entiers." }); return; }
  const product = await db.product.findUnique({ where: { id: params.data.id } });
  if (!product || product.status === "ARCHIVED") { res.status(404).json({ error: "Produit actif ou en aperçu requis." }); return; }
  const data = input.data;
  if ([data.sku, data.barcode, data.size, data.color].some(s => !s.trim())) { res.status(400).json({ error: "Les champs de la variante sont obligatoires." }); return; }
  const userId = (res.locals.identity as Identity).user.id;
  const variant = await db.$transaction(async tx => {
    const size = await tx.size.upsert({ where: { name: data.size.trim() }, update: {}, create: { name: data.size.trim() } });
    const color = await tx.color.upsert({ where: { name: data.color.trim() }, update: {}, create: { name: data.color.trim() } });
    const location = await tx.location.findUniqueOrThrow({ where: { code: "STORE" } });
    const created = await tx.productVariant.create({
      data: { productId: product.id, sizeId: size.id, colorId: color.id, sku: data.sku.trim(), barcode: data.barcode.trim(), priceMinor: data.priceMinor, costMinor: data.costMinor, inventory: { create: { locationId: location.id, onHand: 0, reserved: 0 } } },
    });
    await tx.auditLog.create({ data: { userId, action: "VARIANT_CREATED", detail: `Variante ${data.sku.trim()} créée avec stock nul.` } });
    return { ...created, size: size.name, color: color.name, available: 0 };
  });
  res.status(201).json(CreateVariantResponse.parse(variant));
});
export default router;
