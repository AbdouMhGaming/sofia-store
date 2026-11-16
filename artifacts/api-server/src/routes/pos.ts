import { Router, type IRouter, type Response } from "express";
import {
  db, posTransaction, openDrawer, closeDrawer, recordCashSale, recordRefund, saveReceiptSettings,
  receiptSettings, registerOutput, registerOutputs, saleInclude, saleOutput, posManager, type Prisma, type PosActor,
  cancelSaleAttempt, cancelRefundAttempt, cancelRegisterAttempt,
} from "@workspace/db";
import {
  GetPosContextResponse, SearchPosVariantsQueryParams, SearchPosVariantsResponse, LookupPosBarcodeQueryParams, LookupPosBarcodeResponse,
  ListRegisterSessionsQueryParams, ListRegisterSessionsResponse, OpenRegisterBody, OpenRegisterResponse,
  CloseRegisterParams, CloseRegisterBody, CloseRegisterResponse,
  ListPosSalesQueryParams, ListPosSalesResponse, CreatePosSaleBody, CreatePosSaleResponse,
  RecoverPosSaleParams, RecoverPosSaleResponse, GetPosSaleParams, GetPosSaleResponse,
  RefundPosSaleParams, RefundPosSaleBody, RefundPosSaleResponse, UpdateReceiptSettingsBody, UpdateReceiptSettingsResponse,
  CancelPosSaleRequestBody, CancelPosSaleRequestResponse, CancelPosRefundRequestBody, CancelPosRefundRequestResponse,
  CancelRegisterRequestBody, CancelRegisterRequestResponse,
} from "@workspace/api-zod";
import { identity, type Identity } from "../lib/security";

const variantInclude = {
  product: { include: { category: true, images: { orderBy: { position: "asc" as const }, take: 1 } } },
  size: true, color: true, inventory: { where: { location: { code: "STORE" } } },
} satisfies Prisma.ProductVariantInclude;
type Variant = Prisma.ProductVariantGetPayload<{ include: typeof variantInclude }>;
function variantOutput(v: Variant) {
  const stock = v.inventory[0];
  if (!stock) throw Object.assign(new Error("Stock de cette variante non configuré."), { status: 409 });
  return { id: v.id, productId: v.productId, productName: v.product.nameFr, nameAr: v.product.nameAr,
    category: v.product.category.nameFr, image: v.product.images[0]?.path || "", sku: v.sku, barcode: v.barcode,
    size: v.size.name, color: v.color.name, priceMinor: v.priceMinor,
    available: stock.onHand - stock.reserved };
}
export function createPosRouter(registerCode = "MAIN"): IRouter {
  const router: IRouter = Router();
  router.use(async (req, res, next) => {
    const who = (res.locals.identity as Identity | null) || await identity(req);
    if (!who) { res.status(401).json({ error: "Connexion requise." }); return; }
    if (who.user.mustChangePassword) { res.status(403).json({ error: "Changez d'abord votre mot de passe temporaire." }); return; }
    if (!["STORE_OWNER", "MANAGER", "CASHIER"].includes(who.user.role)) { res.status(403).json({ error: "Accès caisse non autorisé." }); return; }
    res.locals.identity = who;
    res.locals.posActor = { id: who.user.id, role: who.user.role, registerCode } satisfies PosActor;
    next();
  });
  const actor = (res: Response) => res.locals.posActor as PosActor;
  router.get("/context", async (_req, res): Promise<void> => {
    const who = actor(res);
    const result = await db.$transaction(async tx => {
      const register = await tx.cashRegister.findUnique({ where: { code: registerCode } });
      if (!register) return null;
      const activeSession = register.currentSessionId ? await registerOutput(tx, register.currentSessionId) : null;
      return {
        userId: who.id, canManage: posManager(who),
        canSell: activeSession?.status === "OPEN" && activeSession.openedById === who.id,
        registerName: register.name, activeSession, receiptSettings: await receiptSettings(tx),
      };
    });
    if (!result) { res.status(503).json({ error: "Configuration de la caisse manquante. Exécutez la migration POS." }); return; }
    res.json(GetPosContextResponse.parse(result));
  });
  router.get("/variants", async (req, res): Promise<void> => {
    const input = SearchPosVariantsQueryParams.safeParse(req.query);
    if (!input.success) { res.status(400).json({ error: "Recherche invalide." }); return; }
    const q = input.data.q?.trim();
    const rows = await db.productVariant.findMany({
      where: { product: { status: { not: "ARCHIVED" } }, ...(q ? { OR: [
        { sku: { contains: q } }, { barcode: { contains: q } }, { product: { nameFr: { contains: q } } }, { product: { nameAr: { contains: q } } },
      ] } : {}) },
      include: variantInclude, orderBy: { id: "desc" }, take: 40,
    });
    res.json(SearchPosVariantsResponse.parse(rows.map(variantOutput)));
  });
  router.get("/lookup", async (req, res): Promise<void> => {
    const input = LookupPosBarcodeQueryParams.safeParse(req.query);
    if (!input.success) { res.status(400).json({ error: "Code-barres invalide." }); return; }
    const row = await db.productVariant.findUnique({ where: { barcode: input.data.barcode }, include: variantInclude });
    if (!row || row.barcode !== input.data.barcode || row.product.status === "ARCHIVED") { res.status(404).json({ error: "Aucune variante disponible au catalogue pour ce code-barres exact." }); return; }
    res.json(LookupPosBarcodeResponse.parse(variantOutput(row)));
  });
  router.get("/register-sessions", async (req, res): Promise<void> => {
    const input = ListRegisterSessionsQueryParams.safeParse(req.query);
    if (!input.success) { res.status(400).json({ error: "Pagination invalide." }); return; }
    const who = actor(res);
    const data = await db.$transaction(async tx => {
      const rows = await tx.registerSession.findMany({ where: {
        register: { code: registerCode }, ...(!posManager(who) ? { openedById: who.id } : {}),
        ...(input.data.before ? { id: { lt: input.data.before } } : {}),
      }, orderBy: { id: "desc" }, take: 31, select: { id: true } });
      const ids = rows.slice(0, 30).map(r => r.id);
      return { items: await registerOutputs(tx, ids), nextCursor: rows.length > 30 ? ids.at(-1)! : null };
    });
    res.json(ListRegisterSessionsResponse.parse(data));
  });
  router.post("/register-sessions", async (req, res): Promise<void> => {
    const input = OpenRegisterBody.safeParse(req.body);
    if (!input.success) { res.status(400).json({ error: "Fond de caisse ou référence invalide." }); return; }
    res.json(OpenRegisterResponse.parse(await posTransaction(tx => openDrawer(tx, input.data, actor(res)))));
  });
  router.post("/register-sessions/:id/close", async (req, res): Promise<void> => {
    const params = CloseRegisterParams.safeParse(req.params), input = CloseRegisterBody.safeParse(req.body);
    if (!params.success || !input.success) { res.status(400).json({ error: "Comptage, motif ou référence invalide." }); return; }
    res.json(CloseRegisterResponse.parse(await posTransaction(tx => closeDrawer(tx, params.data.id, input.data, actor(res)))));
  });
  router.post("/register-sessions/cancel-request", async (req, res): Promise<void> => {
    const input = CancelRegisterRequestBody.safeParse(req.body);
    if (!input.success) { res.status(400).json({ error: "Référence d'ouverture/clôture invalide." }); return; }
    res.json(CancelRegisterRequestResponse.parse(await posTransaction(tx => cancelRegisterAttempt(tx, input.data, actor(res)))));
  });
  router.get("/sales", async (req, res): Promise<void> => {
    const input = ListPosSalesQueryParams.safeParse(req.query);
    if (!input.success) { res.status(400).json({ error: "Recherche ou pagination invalide." }); return; }
    const who = actor(res), q = input.data.q?.trim();
    const data = await db.$transaction(async tx => {
      const rows = await tx.sale.findMany({ where: {
        ...(!posManager(who) ? { userId: who.id } : {}),
        ...(input.data.before ? { id: { lt: input.data.before } } : {}),
        ...(q ? { OR: [{ number: { contains: q } }, { items: { some: { OR: [{ productName: { contains: q } }, { sku: { contains: q } }, { barcode: { contains: q } }] } } }] } : {}),
      }, include: saleInclude, orderBy: { id: "desc" }, take: 31 });
      return { items: rows.slice(0, 30).map(saleOutput), nextCursor: rows.length > 30 ? rows[29]!.id : null };
    });
    res.json(ListPosSalesResponse.parse(data));
  });
  router.post("/sales", async (req, res): Promise<void> => {
    const input = CreatePosSaleBody.safeParse(req.body);
    if (!input.success) { res.status(400).json({ error: "Panier, montants ou référence invalides." }); return; }
    res.json(CreatePosSaleResponse.parse(await posTransaction(tx => recordCashSale(tx, input.data, actor(res)))));
  });
  router.post("/sales/cancel-request", async (req, res): Promise<void> => {
    const input = CancelPosSaleRequestBody.safeParse(req.body);
    if (!input.success) { res.status(400).json({ error: "Référence de vente invalide." }); return; }
    res.json(CancelPosSaleRequestResponse.parse(await posTransaction(tx => cancelSaleAttempt(tx, input.data, actor(res)))));
  });
  router.post("/refunds/cancel-request", async (req, res): Promise<void> => {
    const input = CancelPosRefundRequestBody.safeParse(req.body);
    if (!input.success) { res.status(400).json({ error: "Référence de remboursement invalide." }); return; }
    res.json(CancelPosRefundRequestResponse.parse(await posTransaction(tx => cancelRefundAttempt(tx, input.data, actor(res)))));
  });
  router.get("/sales/by-request/:requestId", async (req, res): Promise<void> => {
    const input = RecoverPosSaleParams.safeParse(req.params);
    if (!input.success) { res.status(400).json({ error: "Référence invalide." }); return; }
    const who = actor(res);
    const row = await db.$transaction(tx => tx.sale.findFirst({ where: { requestId: input.data.requestId, ...(!posManager(who) ? { userId: who.id } : {}) }, include: saleInclude }));
    if (!row) { res.status(404).json({ error: "Aucune vente confirmée pour cette référence. Si une requête est encore en cours, réessayez avec la même référence." }); return; }
    res.json(RecoverPosSaleResponse.parse(saleOutput(row)));
  });
  router.get("/sales/:id", async (req, res): Promise<void> => {
    const input = GetPosSaleParams.safeParse(req.params);
    if (!input.success) { res.status(400).json({ error: "Ticket invalide." }); return; }
    const who = actor(res);
    const row = await db.$transaction(tx => tx.sale.findFirst({ where: { id: input.data.id, ...(!posManager(who) ? { userId: who.id } : {}) }, include: saleInclude }));
    if (!row) { res.status(404).json({ error: "Ticket introuvable." }); return; }
    res.json(GetPosSaleResponse.parse(saleOutput(row)));
  });
  router.post("/sales/:id/refunds", async (req, res): Promise<void> => {
    if (!posManager(actor(res))) { res.status(403).json({ error: "Autorisation d'un responsable requise." }); return; }
    const params = RefundPosSaleParams.safeParse(req.params), input = RefundPosSaleBody.safeParse(req.body);
    if (!params.success || !input.success) { res.status(400).json({ error: "Retour, quantités ou motif invalides." }); return; }
    res.json(RefundPosSaleResponse.parse(await posTransaction(tx => recordRefund(tx, params.data.id, input.data, actor(res)))));
  });
  router.put("/receipt-settings", async (req, res): Promise<void> => {
    const input = UpdateReceiptSettingsBody.safeParse(req.body);
    if (!input.success) { res.status(400).json({ error: "Coordonnées de ticket invalides." }); return; }
    res.json(UpdateReceiptSettingsResponse.parse(await posTransaction(tx => saveReceiptSettings(tx, input.data, actor(res)))));
  });
  return router;
}
export default createPosRouter();
