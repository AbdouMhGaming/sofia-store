import { Router, type IRouter } from "express";
import {
  db, posTransaction, publishCheckoutSettings, checkoutSettings, buildCheckoutQuote, placeWebOrder,
  recoverWebOrder, abandonWebOrderRequest, saveCheckoutSettings, cancelWebOrder, expireCheckoutOrders,
  webOrderInclude, adminWebOrderOutput, type PosActor,
  actOnWebOrder, recordWebPayment, recoverWebCommand, abandonWebCommand,
} from "@workspace/db";
import {
  GetCheckoutConfigResponse, QuoteCheckoutBody, QuoteCheckoutResponse, PlaceCheckoutOrderBody, PlaceCheckoutOrderResponse,
  RecoverCheckoutOrderBody, RecoverCheckoutOrderResponse, CancelCheckoutRequestBody, CancelCheckoutRequestResponse,
  GetAdminCheckoutSettingsResponse, SaveAdminCheckoutSettingsBody, SaveAdminCheckoutSettingsResponse,
  ListAdminOrdersQueryParams, ListAdminOrdersResponse, GetAdminOrderParams, GetAdminOrderResponse,
  CancelAdminOrderParams, CancelAdminOrderBody, CancelAdminOrderResponse,
  ActOnAdminOrderParams, ActOnAdminOrderBody, ActOnAdminOrderResponse,
  RecordAdminOrderPaymentParams, RecordAdminOrderPaymentBody, RecordAdminOrderPaymentResponse,
  RecoverAdminOrderRequestParams, RecoverAdminOrderRequestResponse,
  AbandonAdminOrderRequestParams, AbandonAdminOrderRequestBody, AbandonAdminOrderRequestResponse,
} from "@workspace/api-zod";
import type { Identity } from "../lib/security";

const router: IRouter = Router();
// Bounded, process-local development defense. Production/multi-instance hardening
// remains a launch gate; no customer names, phone numbers or capability tokens are keys.
const windows = new Map<string, { resetAt: number; count: number }>();
router.use("/checkout", (req, res, next) => {
  if (req.method === "GET") { next(); return; }
  const now = Date.now(), group = req.path === "/orders" ? "order" : "other";
  const key = `${group}:${req.ip || req.socket.remoteAddress || "unknown"}`;
  if (windows.size >= 10000) for (const [id, v] of windows) if (v.resetAt <= now) windows.delete(id);
  let state = windows.get(key);
  if (!state || state.resetAt <= now) {
    if (windows.size >= 10000 && !state) { res.status(429).json({ error: "Service occupé. Réessayez plus tard." }); return; }
    state = { resetAt: now + 15 * 60000, count: 0 }; windows.set(key, state);
  }
  state.count++;
  if (state.count > (group === "order" ? 10 : 180)) {
    res.setHeader("Retry-After", Math.max(1, Math.ceil((state.resetAt - now) / 1000)));
    res.status(429).json({ error: "Trop de tentatives. Conservez votre référence et réessayez plus tard." }); return;
  }
  next();
});
router.get("/checkout/config", async (_req, res): Promise<void> => {
  res.json(GetCheckoutConfigResponse.parse(await db.$transaction(publishCheckoutSettings)));
});
router.post("/checkout/quote", async (req, res): Promise<void> => {
  const body = QuoteCheckoutBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Panier ou mode de réception invalide." }); return; }
  // Expiry owns only order/inventory locks; release them before acquiring product
  // locks for a new order. Never invert POS product->inventory lock ordering.
  await posTransaction(expireCheckoutOrders);
  res.json(QuoteCheckoutResponse.parse(await posTransaction(tx => buildCheckoutQuote(tx, body.data))));
});
router.post("/checkout/orders", async (req, res): Promise<void> => {
  const body = PlaceCheckoutOrderBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Coordonnées, consentement ou référence de commande invalides." }); return; }
  await posTransaction(expireCheckoutOrders);
  res.json(PlaceCheckoutOrderResponse.parse(await posTransaction(tx => placeWebOrder(tx, body.data))));
});
router.post("/checkout/recover", async (req, res): Promise<void> => {
  const body = RecoverCheckoutOrderBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Référence privée invalide." }); return; }
  res.json(RecoverCheckoutOrderResponse.parse(await posTransaction(tx => recoverWebOrder(tx, body.data))));
});
router.post("/checkout/cancel-request", async (req, res): Promise<void> => {
  const body = CancelCheckoutRequestBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Référence privée invalide." }); return; }
  res.json(CancelCheckoutRequestResponse.parse(await posTransaction(tx => abandonWebOrderRequest(tx, body.data))));
});
const actor = (locals: Record<string, unknown>): PosActor => {
  const who = locals.identity as Identity;
  return { id: who.user.id, role: who.user.role };
};
// /admin is already protected by requireStaff before this router is mounted.
router.get("/admin/checkout-settings", async (_req, res): Promise<void> => {
  res.json(GetAdminCheckoutSettingsResponse.parse(await db.$transaction(checkoutSettings)));
});
router.put("/admin/checkout-settings", async (req, res): Promise<void> => {
  const body = SaveAdminCheckoutSettingsBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Configuration de vente en ligne invalide." }); return; }
  res.json(SaveAdminCheckoutSettingsResponse.parse(await posTransaction(tx => saveCheckoutSettings(tx, body.data, actor(res.locals)))));
});
router.get("/admin/orders", async (req, res): Promise<void> => {
  const input = ListAdminOrdersQueryParams.safeParse(req.query);
  if (!input.success) { res.status(400).json({ error: "Recherche de commande invalide." }); return; }
  const data = await db.$transaction(async tx => {
    const rows = await tx.webOrder.findMany({ where: {
      ...(input.data.before ? { id: { lt: input.data.before } } : {}),
      ...(input.data.status ? { status: input.data.status } : {}),
      ...(input.data.q?.trim() ? { reference: { contains: input.data.q.trim() } } : {}),
      ...(input.data.payment === "UNPAID" ? { courierCollected: false, payments: { none: { kind: "RECEIPT" } } } : {}),
      ...(input.data.payment === "COURIER_DUE" ? { courierCollected: true, payments: { none: { kind: "RECEIPT" } } } : {}),
      ...(input.data.payment === "RECEIVED" ? { payments: { some: { kind: "RECEIPT" }, none: { kind: "REFUND" } } } : {}),
      ...(input.data.payment === "REFUNDED" ? { payments: { some: { kind: "REFUND" } } } : {}),
    }, orderBy: { id: "desc" }, take: 31, include: webOrderInclude });
    return { items: rows.slice(0, 30).map(adminWebOrderOutput), nextCursor: rows.length > 30 ? rows[29]!.id : null };
  });
  res.json(ListAdminOrdersResponse.parse(data));
});
router.get("/admin/orders/:id", async (req, res): Promise<void> => {
  const params = GetAdminOrderParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Commande invalide." }); return; }
  const row = await db.webOrder.findUnique({ where: { id: params.data.id }, include: webOrderInclude });
  if (!row) { res.status(404).json({ error: "Commande introuvable." }); return; }
  res.json(GetAdminOrderResponse.parse(adminWebOrderOutput(row)));
});
router.post("/admin/orders/:id/cancel", async (req, res): Promise<void> => {
  const params = CancelAdminOrderParams.safeParse(req.params), body = CancelAdminOrderBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Commande ou motif d'annulation invalide." }); return; }
  res.json(CancelAdminOrderResponse.parse(await posTransaction(tx => cancelWebOrder(tx, params.data.id, body.data.reason, actor(res.locals)))));
});
router.post("/admin/orders/:id/actions", async (req, res): Promise<void> => {
  const params = ActOnAdminOrderParams.safeParse(req.params), body = ActOnAdminOrderBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Opération de commande invalide." }); return; }
  await posTransaction(expireCheckoutOrders);
  res.json(ActOnAdminOrderResponse.parse(await posTransaction(tx => actOnWebOrder(tx, params.data.id, body.data, actor(res.locals)))));
});
router.post("/admin/orders/:id/payments", async (req, res): Promise<void> => {
  const params = RecordAdminOrderPaymentParams.safeParse(req.params), body = RecordAdminOrderPaymentBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Encaissement ou remboursement invalide." }); return; }
  res.json(RecordAdminOrderPaymentResponse.parse(await posTransaction(tx => recordWebPayment(tx, params.data.id, body.data, actor(res.locals)))));
});
router.get("/admin/orders/:id/requests/:requestId", async (req, res): Promise<void> => {
  const params = RecoverAdminOrderRequestParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Référence d'opération invalide." }); return; }
  res.json(RecoverAdminOrderRequestResponse.parse(await db.$transaction(tx => recoverWebCommand(tx, params.data.id, params.data.requestId, actor(res.locals)))));
});
router.post("/admin/orders/:id/requests/cancel", async (req, res): Promise<void> => {
  const params = AbandonAdminOrderRequestParams.safeParse(req.params), body = AbandonAdminOrderRequestBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Référence d'opération invalide." }); return; }
  res.json(AbandonAdminOrderRequestResponse.parse(await posTransaction(tx => abandonWebCommand(tx, params.data.id, body.data.requestId, actor(res.locals)))));
});
export default router;
