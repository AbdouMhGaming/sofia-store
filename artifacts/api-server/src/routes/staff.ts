import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import { listStaffAccounts, executeStaffOperation, recoverStaffOperation, abandonStaffOperation, type StaffActor } from "@workspace/db";
import { ListStaffResponse, ExecuteStaffCommandBody, ExecuteStaffCommandResponse, RecoverStaffCommandParams, RecoverStaffCommandResponse, AbandonStaffCommandBody, AbandonStaffCommandResponse } from "@workspace/api-zod";
import type { Identity } from "../lib/security";

const router: IRouter = Router();
router.use("/admin/staff", (_req, res, next) => {
  res.set("Cache-Control", "private, no-store").vary("Cookie");
  const who = res.locals.identity as Identity;
  if (who.user.role !== "STORE_OWNER") { res.status(403).json({ error: "Gestion du personnel réservée au propriétaire." }); return; }
  next();
});
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: "draft-7", legacyHeaders: false,
  message: { error: "Trop d'opérations personnel. Réessayez plus tard sans changer la tentative en cours." } });
const actor = (who: Identity): StaffActor => ({ id: who.user.id, role: who.user.role, tokenHash: who.tokenHash });
router.get("/admin/staff", async (_req, res): Promise<void> => {
  res.json(ListStaffResponse.parse(await listStaffAccounts(actor(res.locals.identity))));
});
router.post("/admin/staff/commands", limiter, async (req, res): Promise<void> => {
  const input = ExecuteStaffCommandBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Compte, rôle, version ou motif invalide." }); return; }
  res.json(ExecuteStaffCommandResponse.parse(await executeStaffOperation(input.data, actor(res.locals.identity))));
});
router.get("/admin/staff/requests/:requestId", async (req, res): Promise<void> => {
  const params = RecoverStaffCommandParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Référence invalide." }); return; }
  res.json(RecoverStaffCommandResponse.parse(await recoverStaffOperation(params.data.requestId, actor(res.locals.identity))));
});
router.post("/admin/staff/requests/cancel", limiter, async (req, res): Promise<void> => {
  const input = AbandonStaffCommandBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Tentative invalide ; aucun abandon confirmé." }); return; }
  res.json(AbandonStaffCommandResponse.parse(await abandonStaffOperation(input.data, actor(res.locals.identity))));
});
export default router;
