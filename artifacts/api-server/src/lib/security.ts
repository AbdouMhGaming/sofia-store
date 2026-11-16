import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
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
export function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (err, key) => {
      if (err) reject(err);
      else resolve(`scrypt$32768$${salt}$${key.toString("hex")}`);
    });
  });
}
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, n, salt, expected] = stored.split("$");
  if (algorithm !== "scrypt" || n !== "32768" || !salt || !expected) return false;
  const actual = await new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (err, key) => err ? reject(err) : resolve(key));
  });
  return safeEqual(actual.toString("hex"), expected);
}
export type Identity = { user: User; tokenHash: string; csrfToken: string };
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
  };
}
export async function newSession(req: Request, res: Response, userId: number) {
  const token = randomBytes(32).toString("hex");
  const csrfToken = hmac(`csrf:${token}`);
  await db.session.create({ data: { tokenHash: sha256(token), userId, csrfHash: sha256(csrfToken), expiresAt: new Date(Date.now() + 8 * 3600 * 1000) } });
  res.cookie(cookieName, token, cookieOptions(req));
  res.clearCookie(csrfCookie, { path: "/api" });
  return csrfToken;
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
  if (!req.is("application/json")) { res.status(415).json({ error: "Requête JSON requise." }); return; }
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
