import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  CreateCategoryBody, UpdateCategoryBody, UpdateCategoryParams, DeleteCategoryParams,
  UpdateVariantBody, UpdateVariantParams, UpdateVariantResponse, ListStockMovementsQueryParams, ListStockMovementsResponse,
} from "@workspace/api-zod";
import type { Identity } from "../lib/security";

const router: IRouter = Router();
router.post("/admin/categories", async (req, res): Promise<void> => {
  const input = CreateCategoryBody.safeParse(req.body);
  if (!input.success || !input.data.nameFr.trim() || !input.data.nameAr.trim()) { res.status(400).json({ error: "Nom français, nom arabe et identifiant valides requis." }); return; }
  const userId = (res.locals.identity as Identity).user.id;
  const category = await db.$transaction(async tx => {
    const row = await tx.category.create({ data: { ...input.data, nameFr: input.data.nameFr.trim(), nameAr: input.data.nameAr.trim() } });
    await tx.auditLog.create({ data: { userId, action: "CATEGORY_CREATED", detail: `Catégorie créée : ${row.nameFr}` } });
    return row;
  });
  res.status(201).json(category);
});
router.put("/admin/categories/:id", async (req, res): Promise<void> => {
  const params = UpdateCategoryParams.safeParse(req.params), input = UpdateCategoryBody.safeParse(req.body);
  if (!params.success || !input.success || !input.data.nameFr.trim() || !input.data.nameAr.trim()) { res.status(400).json({ error: "Catégorie invalide." }); return; }
  const userId = (res.locals.identity as Identity).user.id;
  const category = await db.$transaction(async tx => {
    const updated = await tx.category.update({ where: { id: params.data.id }, data: { ...input.data, nameFr: input.data.nameFr.trim(), nameAr: input.data.nameAr.trim() } });
    await tx.auditLog.create({ data: { userId, action: "CATEGORY_UPDATED", detail: `Catégorie modifiée : ${updated.nameFr}` } });
    return updated;
  });
  res.json(category);
});
router.delete("/admin/categories/:id", async (req, res): Promise<void> => {
  const params = DeleteCategoryParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Catégorie invalide." }); return; }
  const userId = (res.locals.identity as Identity).user.id;
  await db.$transaction(async tx => {
    const category = await tx.category.findUnique({ where: { id: params.data.id } });
    if (!category) throw Object.assign(new Error("Catégorie introuvable."), { status: 404 });
    if (await tx.product.count({ where: { categoryId: category.id } })) throw Object.assign(new Error("Cette catégorie contient des produits, y compris éventuellement des archives. Réaffectez-les avant de la supprimer."), { status: 409 });
    await tx.category.delete({ where: { id: category.id } });
    await tx.auditLog.create({ data: { userId, action: "CATEGORY_DELETED", detail: `Catégorie vide supprimée : ${category.nameFr}` } });
  });
  res.json({ message: "Catégorie vide supprimée." });
});
router.put("/admin/variants/:id", async (req, res): Promise<void> => {
  const params = UpdateVariantParams.safeParse(req.params), input = UpdateVariantBody.safeParse(req.body);
  if (!params.success || !input.success || [input.data.sku, input.data.barcode, input.data.size, input.data.color].some(v => !v.trim())) { res.status(400).json({ error: "Variante invalide." }); return; }
  const userId = (res.locals.identity as Identity).user.id, data = input.data;
  const result = await db.$transaction(async tx => {
    const previous = await tx.productVariant.findUnique({ where: { id: params.data.id } });
    if (!previous) throw Object.assign(new Error("Variante introuvable."), { status: 404 });
    const size = await tx.size.upsert({ where: { name: data.size.trim() }, update: {}, create: { name: data.size.trim() } });
    const color = await tx.color.upsert({ where: { name: data.color.trim() }, update: {}, create: { name: data.color.trim() } });
    const row = await tx.productVariant.update({
      where: { id: params.data.id },
      data: { sizeId: size.id, colorId: color.id, sku: data.sku.trim(), barcode: data.barcode.trim(), priceMinor: data.priceMinor, costMinor: data.costMinor },
      include: { inventory: true, product: { include: { images: { orderBy: { position: "asc" }, take: 1 } } } },
    });
    await tx.auditLog.create({ data: { userId, action: "VARIANT_UPDATED", detail: `Variante ${previous.sku} → ${row.sku}. Prix : ${previous.priceMinor} → ${row.priceMinor} centimes ; coût : ${previous.costMinor} → ${row.costMinor} centimes ; taille/couleur : ${previous.sizeId}/${previous.colorId} → ${size.id}/${color.id}. Stock inchangé.` } });
    const onHand = row.inventory.reduce((n, i) => n + i.onHand, 0), reserved = row.inventory.reduce((n, i) => n + i.reserved, 0);
    return { id: row.id, productId: row.productId, productName: row.product.nameFr, image: row.product.images[0]?.path || "", sku: row.sku, barcode: row.barcode, size: size.name, color: color.name, priceMinor: row.priceMinor, costMinor: row.costMinor, onHand, reserved, available: onHand - reserved };
  });
  res.json(UpdateVariantResponse.parse(result));
});
router.get("/admin/stock-movements", async (req, res): Promise<void> => {
  const input = ListStockMovementsQueryParams.safeParse(req.query);
  if (!input.success) { res.status(400).json({ error: "Filtre de mouvements invalide." }); return; }
  const rows = await db.stockMovement.findMany({
    where: { ...(input.data.variantId ? { variantId: input.data.variantId } : {}), ...(input.data.before ? { id: { lt: input.data.before } } : {}) },
    include: { user: true, variant: { include: { product: true, size: true, color: true } } },
    orderBy: { id: "desc" }, take: 51,
  });
  const items = rows.slice(0, 50).map(r => ({ id: r.id, variantId: r.variantId, productName: r.variant.product.nameFr, sku: r.variant.sku, size: r.variant.size.name, color: r.variant.color.name, quantity: r.quantity, kind: r.kind, reason: r.reason, balanceAfter: r.balanceAfter, actor: r.user.email, createdAt: r.createdAt.toISOString() }));
  res.json(ListStockMovementsResponse.parse({ items, nextCursor: rows.length > 50 ? items.at(-1)!.id : null }));
});
export default router;
