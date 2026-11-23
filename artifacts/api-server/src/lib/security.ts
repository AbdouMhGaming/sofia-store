import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { db, type Prisma } from "@workspace/db";
export { hashStaffPassword as hashPassword, verifyStaffPassword as verifyPassword } from "@workspace/db";
import type { User } from "@workspace/api-zod";

const secret = process.env.SESSION_SECRET;
if (!secret || secret.length < 24) throw new Error("A strong SESSION_SECRET must be configured.");
const cookieName = "sofia_session";
const csrfCookie = "sofia_csrf";
export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const hmac = (value: string) => createHmac("sha256", secret!).update(value).digest("hex");
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function cookieOptions(req: Request) {
  return { httpOnly: true, secure: req.secure, sameSite: "strict" as const, path: "/api", maxAge: 8 * 60 * 60 * 1000 };
}
export type Identity = { user: User; tokenHash: string; csrfToken: string; accountVersion: number };
export async function identity(req: Request): Promise<Identity | null> {
  const token = req.cookies?.[cookieName];
  if (typeof token !== "string" || token.length !== 64) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { include: { roles: { include: { role: true } } } } },
  });
  if (!session || session.expiresAt <= new Date() || !session.user.active) return null;
  const names = session.user.roles.map(r => r.role.name);
  const role = names.includes("STORE_OWNER") ? "STORE_OWNER" : names.includes("MANAGER") ? "MANAGER" : names.includes("CASHIER") ? "CASHIER" : null;
  if (!role) return null;
  return {
    user: { id: session.userId, email: session.user.email, role, mustChangePassword: session.user.mustChangePassword },
    tokenHash: session.tokenHash,
    csrfToken: hmac(`csrf:${token}`),
    accountVersion: session.user.version,
  };
}
export async function prepareSession(tx: Prisma.TransactionClient, userId: number) {
  const token = randomBytes(32).toString("hex");
  const csrfToken = hmac(`csrf:${token}`);
  await tx.session.create({ data: { tokenHash: sha256(token), userId, csrfHash: sha256(csrfToken), expiresAt: new Date(Date.now() + 8 * 3600 * 1000) } });
  return { token, csrfToken };
}
export function sendSessionCookie(req: Request, res: Response, token: string) {
  res.cookie(cookieName, token, cookieOptions(req));
  res.clearCookie(csrfCookie, { path: "/api" });
}
export function anonymousCsrf(req: Request, res: Response): string {
  const old = req.cookies?.[csrfCookie];
  if (typeof old === "string") {
    const [token, signature] = old.split(".");
    if (token?.length === 64 && signature && safeEqual(signature, hmac(`anon:${token}`))) return token;
  }
  const token = randomBytes(32).toString("hex");
  res.cookie(csrfCookie, `${token}.${hmac(`anon:${token}`)}`, cookieOptions(req));
  return token;
}
export async function requireCsrf(req: Request, res: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) { next(); return; }
  const hasBody = Number(req.get("content-length") || 0) > 0 || !!req.get("transfer-encoding");
  const photoUpload = req.method === "PUT" && /^\/storage\/uploads\/[a-f0-9-]{36}$/.test(req.path) && !!req.is(["image/jpeg", "image/png", "image/webp"]);
  if (hasBody && !req.is("application/json") && !photoUpload) { res.status(415).json({ error: "Type de requête non accepté." }); return; }
  const header = req.get("x-csrf-token") || "";
  const who = await identity(req);
  let valid = who ? safeEqual(header, who.csrfToken) : false;
  if (!who) {
    const [token, signature] = String(req.cookies?.[csrfCookie] || "").split(".");
    valid = !!token && !!signature && safeEqual(signature, hmac(`anon:${token}`)) && safeEqual(header, token);
  }
  if (!valid) { res.status(403).json({ error: "Session de sécurité expirée. Rechargez la page." }); return; }
  res.locals.identity = who;
  next();
}
export async function requireStaff(req: Request, res: Response, next: NextFunction) {
  const who = (res.locals.identity as Identity | null | undefined) || await identity(req);
  if (!who) { res.status(401).json({ error: "Connexion requise." }); return; }
  if (who.user.mustChangePassword) { res.status(403).json({ error: "Changez votre mot de passe temporaire avant de continuer." }); return; }
  if (!["STORE_OWNER", "MANAGER"].includes(who.user.role)) { res.status(403).json({ error: "Accès réservé à la gestion." }); return; }
  res.locals.identity = who;
  next();
}
export function clearSession(req: Request, res: Response) {
  res.clearCookie(cookieName, { ...cookieOptions(req), maxAge: undefined });
}
