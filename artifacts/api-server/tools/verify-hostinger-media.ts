import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import express, { type ErrorRequestHandler, type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import sharp from "sharp";
import { db } from "@workspace/db";
import { newSession, requireCsrf, requireStaff } from "../src/lib/security";
import { createMediaRouter } from "../src/routes/media";
import catalogRouter from "../src/routes/catalog-admin";
import { DiskMediaStore, MAX_PHOTO_BYTES, validateUploadRoot } from "../src/lib/media-disk";

// File bytes are disposable generated fixtures, never customer uploads.
const root = await mkdtemp("/tmp/sofia-media-");
const store = new DiskMediaStore(root);
await store.initialize();
let configured = true;
const actors: number[] = [], products: number[] = [];
const suffix = randomUUID();
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use("/api", requireCsrf);
app.use("/api/admin", requireStaff);
app.use("/api", catalogRouter);
app.use("/api", createMediaRouter(async () => configured ? store : null));
const errors: ErrorRequestHandler = (error, _req, res, _next) => {
  res.status(error.status || 500).json({ error: error.status ? error.message : "Verification request failed" });
};
app.use(errors);
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
type Session = { Cookie: string; "x-csrf-token": string };
async function actor(role: "MANAGER" | "CASHIER"): Promise<Session> {
  const record = await db.role.findUniqueOrThrow({ where: { name: role } });
  const user = await db.user.create({ data: { email: `media-${randomUUID()}@invalid.test`, passwordHash: "NO_LOGIN_VERIFICATION_FIXTURE", mustChangePassword: false, roles: { create: { roleId: record.id } } } });
  actors.push(user.id);
  let cookie = "";
  const csrf = await newSession({ secure: false } as Request, {
    cookie: (name: string, value: string) => { cookie = `${name}=${value}`; },
    clearCookie: () => undefined,
  } as unknown as Response, user.id);
  return { Cookie: cookie, "x-csrf-token": csrf };
}
async function jsonCall(path: string, session: Session, method = "GET", data?: unknown) {
  return fetch(base + path, { method, headers: { ...session, "Content-Type": "application/json" }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
}
try {
  assert.throws(() => validateUploadRoot("/home/site/domains/shop/hbuilds/current/nodejs/uploads"));
  assert.throws(() => validateUploadRoot("/home/site/domains/shop/public_html/uploads"));
  assert.throws(() => validateUploadRoot("/tmp/sofia-uploads"));
  assert.throws(() => validateUploadRoot("relative/uploads"));
  validateUploadRoot("/home/site/domains/shop/sofia-private-media", "/home/site/domains/shop/hbuilds/current/nodejs");
  await assert.rejects(store.write("../outside", Buffer.from("x")));
  const owner = await actor("MANAGER"), other = await actor("MANAGER"), cashier = await actor("CASHIER");
  const image = await sharp({ create: { width: 2000, height: 3000, channels: 3, background: "#f4c9d9" } }).png().toBuffer();
  const input = { name: "Generated media verification", size: image.length, contentType: "image/png" };
  assert.equal((await fetch(base + "/admin/media")).status, 401);
  assert.equal((await jsonCall("/storage/uploads/request-url", cashier, "POST", input)).status, 403);
  configured = false;
  assert.equal((await jsonCall("/storage/uploads/request-url", owner, "POST", input)).status, 503);
  assert.equal((await (await jsonCall("/admin/media", owner)).json()).enabled, false);
  configured = true;
  const response = await jsonCall("/storage/uploads/request-url", owner, "POST", input);
  assert.equal(response.status, 200);
  const ticket = await response.json() as { uploadId: string; uploadURL: string };
  assert.match(ticket.uploadURL, /^\/api\/storage\/uploads\/[a-f0-9-]+$/);
  const put = (headers: Record<string, string>, bytes: Buffer = image) => fetch(base.replace(/\/api$/, "") + ticket.uploadURL, { method: "PUT", headers: { ...headers, "Content-Type": "image/png" }, body: bytes });
  assert.equal((await put({ Cookie: owner.Cookie })).status, 403);
  assert.equal((await put(other)).status, 404);
  assert.equal((await put(owner, image.subarray(1))).status, 400);
  assert.equal((await jsonCall(`/admin/media/${ticket.uploadId}/complete`, owner, "POST")).status, 409);
  assert.equal((await put(owner)).status, 200);
  assert.equal((await fetch(`${base}/media/${ticket.uploadId}/image`)).status, 404);
  const completed = await jsonCall(`/admin/media/${ticket.uploadId}/complete`, owner, "POST");
  assert.equal(completed.status, 200);
  const photo = await completed.json() as { id: string; path: string; width: number; height: number };
  assert.equal(photo.width, 1600); assert.equal(photo.height, 2400);
  const row = await db.mediaAsset.findUniqueOrThrow({ where: { id: photo.id } });
  const reopened = new DiskMediaStore(root);
  assert.deepEqual(await reopened.read(`${row.objectPrefix}/image.webp`), await store.read(`${row.objectPrefix}/image.webp`));
  assert.equal((await jsonCall(`/admin/media/${photo.id}/complete`, owner, "POST")).status, 200, "Completion retry must be safe");
  assert.equal((await put(owner)).status, 409, "Completed bytes must not be overwritten");
  assert.equal((await fetch(`${base}/media/${photo.id}/image`)).status, 404, "Unattached library photo is private");
  const staffPhoto = await fetch(`${base}/media/${photo.id}/image`, { headers: owner });
  assert.equal(staffPhoto.status, 200); assert.match(staffPhoto.headers.get("Content-Type") || "", /image\/webp/);
  const category = await db.category.findFirstOrThrow();
  const productInput = {
    nameFr: `Vérification images ${suffix}`, nameAr: "اختبار", descriptionFr: "", descriptionAr: "",
    categoryId: category.id, featured: false, status: "PREVIEW", images: [photo.path, "/products/dress-1.jpeg"],
  };
  const created = await jsonCall("/admin/products", owner, "POST", productInput);
  assert.equal(created.status, 201);
  const product = await created.json() as { id: number; images: string[] };
  products.push(product.id);
  assert.deepEqual(product.images, productInput.images);
  assert.equal((await fetch(`${base}/media/${photo.id}/thumbnail`)).status, 200, "Visible product photo becomes public");
  assert.equal((await jsonCall(`/admin/media/${photo.id}`, owner, "DELETE")).status, 409, "Used photos cannot be deleted");
  const updated = await jsonCall(`/admin/products/${product.id}`, owner, "PUT", { ...productInput, images: ["/products/dress-2.jpeg", photo.path] });
  assert.equal(updated.status, 200);
  assert.deepEqual((await updated.json()).images, ["/products/dress-2.jpeg", photo.path], "Replacement and ordering must persist");
  assert.equal((await jsonCall(`/admin/products/${product.id}`, owner, "PUT", { ...productInput, images: ["/products/dress-2.jpeg"] })).status, 200);
  assert.equal((await fetch(`${base}/media/${photo.id}/image`)).status, 404, "Detachment revokes public visibility");
  assert.equal((await jsonCall(`/admin/media/${photo.id}`, owner, "DELETE")).status, 200);
  assert.equal((await fetch(`${base}/media/${photo.id}/image`, { headers: owner })).status, 404);
  assert.equal((await fetch(base + "/admin/products", { method: "POST", headers: { ...owner, "Content-Type": "image/png" }, body: image })).status, 415, "Binary CSRF exception must be upload-route only");
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>');
  const invalid = await (await jsonCall("/storage/uploads/request-url", owner, "POST", { ...input, size: svg.length })).json() as { uploadId: string; uploadURL: string };
  assert.equal((await fetch(base.replace(/\/api$/, "") + invalid.uploadURL, { method: "PUT", headers: { ...owner, "Content-Type": "image/png" }, body: svg })).status, 200);
  assert.equal((await jsonCall(`/admin/media/${invalid.uploadId}/complete`, owner, "POST")).status, 400, "MIME spoofing must fail actual decode validation");
  assert.equal((await fetch(`${base}/media/${invalid.uploadId}/image`)).status, 404);
  const large = await (await jsonCall("/storage/uploads/request-url", owner, "POST", { ...input, size: MAX_PHOTO_BYTES })).json() as { uploadURL: string };
  assert.equal((await fetch(base.replace(/\/api$/, "") + large.uploadURL, { method: "PUT", headers: { ...owner, "Content-Type": "image/png" }, body: Buffer.alloc(MAX_PHOTO_BYTES + 1) })).status, 413);
  console.log("PASS: Hostinger disk adapter, atomic upload, actual optimization, reopened files, CSRF, roles, ownership, size limits, spoof rejection, private/public access, photo ordering/replacement, attachment protection and removal.");
  console.log("Hostinger account permissions and real redeployment persistence are NOT verified by this local fixture test.");
} catch (error) {
  console.error("FAIL: Hostinger media verification", (error as { code?: string }).code || (error as Error).name, (error as Error).name === "AssertionError" ? (error as Error).message : "");
  process.exitCode = 1;
} finally {
  server.close();
  try {
    await db.$transaction(async tx => {
      await tx.productImage.deleteMany({ where: { productId: { in: products } } });
      await tx.product.deleteMany({ where: { id: { in: products } } });
      await tx.mediaAsset.deleteMany({ where: { userId: { in: actors } } });
      await tx.auditLog.deleteMany({ where: { userId: { in: actors } } });
      await tx.session.deleteMany({ where: { userId: { in: actors } } });
      await tx.userRole.deleteMany({ where: { userId: { in: actors } } });
      await tx.user.deleteMany({ where: { id: { in: actors } } });
    }, { timeout: 60000 });
    console.log("Only verification-created accounts, products, media metadata and files were cleaned up.");
  } catch (error) { console.error("Verification cleanup needs attention:", (error as { code?: string }).code || "CLEANUP_FAILED"); process.exitCode = 1; }
  await db.$disconnect();
  await rm(root, { recursive: true, force: true });
}
