import { Router, type IRouter } from "express";
import { db, Prisma, applyStockAdjustment } from "@workspace/db";
import { AdjustStockBody, ListInventoryResponse, GetAdminSummaryResponse, ListActivityResponse } from "@workspace/api-zod";
import { type Identity } from "../lib/security";

const router: IRouter = Router();
async function activity() {
  const rows = await db.auditLog.findMany({ take: 40, orderBy: { id: "desc" }, include: { user: { include: { roles: { include: { role: true } } } } } });
  return rows.map(r => ({
    id: r.id, action: r.action, detail: r.detail, createdAt: r.createdAt.toISOString(),
    actor: r.user ? (r.user.roles.some(x => x.role.name === "STORE_OWNER") ? "Propriétaire" : "Équipe") : "Système",
  }));
}
router.get("/admin/inventory", async (_req, res): Promise<void> => {
  const variants = await db.productVariant.findMany({
    include: { size: true, color: true, inventory: true, product: { include: { images: { orderBy: { position: "asc" }, take: 1 } } } },
    orderBy: { id: "desc" }, take: 2000,
  });
  res.json(ListInventoryResponse.parse(variants.map(v => {
    const onHand = v.inventory.reduce((n, i) => n + i.onHand, 0), reserved = v.inventory.reduce((n, i) => n + i.reserved, 0);
    return { id: v.id, productId: v.productId, productName: v.product.nameFr, image: v.product.images[0]?.path || "", sku: v.sku, barcode: v.barcode, size: v.size.name, color: v.color.name, priceMinor: v.priceMinor, costMinor: v.costMinor, onHand, reserved, available: onHand - reserved };
  })));
});
router.post("/admin/inventory/adjust", async (req, res): Promise<void> => {
  const input = AdjustStockBody.safeParse(req.body);
  if (!input.success || input.data.quantity === 0 || !input.data.reason.trim() || (input.data.kind === "DAMAGE" && input.data.quantity > 0) || (["RECEIPT", "RETURN"].includes(input.data.kind) && input.data.quantity < 0)) {
    res.status(400).json({ error: "Quantité ou motif invalide. Réception/retour positif, dommage négatif." }); return;
  }
  const data = input.data, userId = (res.locals.identity as Identity).user.id;
  await db.$transaction(async tx => {
    await applyStockAdjustment(tx, data, userId);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  res.json({ message: "Mouvement de stock enregistré." });
});
router.get("/admin/summary", async (_req, res): Promise<void> => {
  const [products, variants, inventory, recentActivity] = await Promise.all([
    db.product.count({ where: { status: { not: "ARCHIVED" } } }),
    db.productVariant.count(),
    db.inventory.findMany({ include: { variant: true } }),
    activity(),
  ]);
  res.json(GetAdminSummaryResponse.parse({
    products, variants,
    availableUnits: inventory.reduce((n, i) => n + i.onHand - i.reserved, 0),
    reservedUnits: inventory.reduce((n, i) => n + i.reserved, 0),
    lowStock: inventory.filter(i => i.onHand - i.reserved <= 3).length,
    valuationMinor: inventory.reduce((n, i) => n + i.onHand * i.variant.costMinor, 0),
    recentActivity,
  }));
});
router.get("/admin/activity", async (_req, res): Promise<void> => { res.json(ListActivityResponse.parse(await activity())); });
export default router;
