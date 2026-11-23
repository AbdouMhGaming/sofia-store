import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import { randomBytes } from "node:crypto";
import { db, posTransaction, lockAccount, accountRole } from "@workspace/db";
import { LoginBody, ChangePasswordBody, ActivateOwnerBody } from "@workspace/api-zod";
import { anonymousCsrf, identity, prepareSession, sendSessionCookie, hashPassword, verifyPassword, safeEqual, sha256, clearSession } from "../lib/security";

const router: IRouter = Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "Trop de tentatives. Réessayez dans 15 minutes." } });
async function setupState() {
  const setupRequired = await db.user.count() === 0;
  return { setupRequired, setupEnabled: setupRequired && (process.env.OWNER_SETUP_TOKEN?.length || 0) >= 32 };
}
router.get("/auth/session", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  const who = await identity(req);
  res.json({ user: who?.user || null, csrfToken: who?.csrfToken || anonymousCsrf(req, res), ...await setupState() });
});
router.post("/auth/login", limiter, async (req, res): Promise<void> => {
  const input = LoginBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Adresse e-mail et mot de passe requis." }); return; }
  const user = await db.user.findUnique({ where: { email: input.data.email.toLowerCase().trim() }, include: { roles: { include: { role: true } } } });
  // Perform the same expensive KDF even for an unknown account.
  const dummy = "scrypt$32768$00000000000000000000000000000000$" + "00".repeat(64);
  const ok = await verifyPassword(input.data.password, user?.passwordHash || dummy);
  if (!ok || !user?.active) { res.status(401).json({ error: "Identifiants incorrects." }); return; }
  const old = await identity(req);
  const result = await posTransaction(async tx => {
    const current = await lockAccount(tx, user.id);
    if (!current.active || current.version !== user.version || current.passwordHash !== user.passwordHash)
      throw Object.assign(new Error("Le compte a changé. Reconnectez-vous."), { status: 401 });
    const role = accountRole(current);
    if (!role) throw Object.assign(new Error("Compte sans autorisation."), { status: 403 });
    if (old) await tx.session.deleteMany({ where: { tokenHash: old.tokenHash } });
    const session = await prepareSession(tx, user.id);
    await tx.auditLog.create({ data: { userId: user.id, action: "LOGIN", detail: "Connexion à l'espace de gestion." } });
    return { ...session, user: { id: user.id, email: user.email, role, mustChangePassword: current.mustChangePassword } };
  });
  sendSessionCookie(req, res, result.token);
  res.json({ user: result.user, csrfToken: result.csrfToken, setupRequired: false, setupEnabled: false });
});
router.post("/auth/logout", async (req, res): Promise<void> => {
  const who = await identity(req);
  if (who) await db.session.deleteMany({ where: { tokenHash: who.tokenHash } });
  clearSession(req, res);
  res.json({ message: "Déconnexion effectuée." });
});
router.post("/auth/password", limiter, async (req, res): Promise<void> => {
  const who = await identity(req);
  if (!who) { res.status(401).json({ error: "Connexion requise." }); return; }
  const parsed = ChangePasswordBody.safeParse(req.body);
  if (!parsed.success || parsed.data.currentPassword === parsed.data.newPassword) { res.status(400).json({ error: "Choisissez un nouveau mot de passe différent d'au moins 14 caractères." }); return; }
  const user = await db.user.findUniqueOrThrow({ where: { id: who.user.id } });
  if (!await verifyPassword(parsed.data.currentPassword, user.passwordHash)) { res.status(401).json({ error: "Mot de passe actuel incorrect." }); return; }
  const passwordHash = await hashPassword(parsed.data.newPassword);
  const result = await posTransaction(async tx => {
    const current = await lockAccount(tx, user.id);
    const session = await tx.session.findUnique({ where: { tokenHash: who.tokenHash } });
    if (!current.active || current.version !== user.version || current.passwordHash !== user.passwordHash || !session || session.expiresAt <= new Date())
      throw Object.assign(new Error("Le compte ou la session a changé. Reconnectez-vous."), { status: 401 });
    await tx.user.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: false, version: { increment: 1 } } });
    await tx.session.deleteMany({ where: { userId: user.id } });
    await tx.auditLog.create({ data: { userId: user.id, action: "PASSWORD_CHANGE", detail: "Mot de passe modifié et anciennes sessions révoquées." } });
    return prepareSession(tx, user.id);
  });
  sendSessionCookie(req, res, result.token);
  res.json({ user: { ...who.user, mustChangePassword: false }, csrfToken: result.csrfToken, setupRequired: false, setupEnabled: false });
});
router.post("/auth/activate", limiter, async (req, res): Promise<void> => {
  const parsed = ActivateOwnerBody.safeParse(req.body);
  const configured = process.env.OWNER_SETUP_TOKEN;
  if (!parsed.success || !configured || configured.length < 32 || !safeEqual(sha256(parsed.data.token), sha256(configured))) {
    res.status(403).json({ error: "Activation non autorisée." }); return;
  }
  if (await db.user.count() !== 0) { res.status(409).json({ error: "Le propriétaire est déjà configuré." }); return; }
  const temporaryPassword = randomBytes(24).toString("base64url");
  const passwordHash = await hashPassword(temporaryPassword);
  const email = parsed.data.email.trim().toLowerCase();
  await db.$transaction(async tx => {
    await tx.setupClaim.create({ data: { id: 1 } });
    const role = await tx.role.upsert({ where: { name: "STORE_OWNER" }, update: {}, create: { name: "STORE_OWNER" } });
    const user = await tx.user.create({ data: { email, passwordHash, mustChangePassword: true, roles: { create: { roleId: role.id } } } });
    await tx.auditLog.create({ data: { userId: user.id, action: "OWNER_ACTIVATED", detail: "Activation unique du propriétaire." } });
  });
  res.setHeader("Cache-Control", "no-store, private");
  res.status(201).json({ email, temporaryPassword });
});
export default router;
