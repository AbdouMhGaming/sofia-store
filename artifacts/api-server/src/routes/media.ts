import { randomUUID } from "node:crypto";
import { raw, Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import { db } from "@workspace/db";
import { RequestUploadUrlBody, PutMediaUploadParams, CompleteMediaParams, DeleteMediaParams, ListMediaResponse } from "@workspace/api-zod";
import { requireStaff, identity, type Identity } from "../lib/security";
import { mediaOutput, processStoredPhoto } from "../lib/media";
import { getMediaStore, MAX_PHOTO_BYTES, type DiskMediaStore } from "../lib/media-disk";

export function createMediaRouter(resolveStore: () => Promise<DiskMediaStore | null> = getMediaStore): IRouter {
const router: IRouter = Router();
const uploadLimit = rateLimit({ windowMs: 10 * 60 * 1000, limit: 40, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "Trop de demandes d'images. Réessayez plus tard." } });
router.get("/admin/media", async (_req, res): Promise<void> => {
  const rows = await db.mediaAsset.findMany({ where: { status: "READY" }, orderBy: { createdAt: "desc" }, take: 500 });
  res.json(ListMediaResponse.parse({ enabled: !!await resolveStore(), items: rows.map(mediaOutput) }));
});
router.post("/storage/uploads/request-url", requireStaff, uploadLimit, async (req, res): Promise<void> => {
  const input = RequestUploadUrlBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Photo invalide : JPEG, PNG ou WebP de 8 Mio maximum." }); return; }
  if (!await resolveStore()) { res.status(503).json({ error: "Le dossier persistant des photos Hostinger n'est pas configuré ou accessible. Aucun stockage temporaire n'est utilisé." }); return; }
  const id = randomUUID(), originalPath = `pending/${id}/source`;
  const row = await db.mediaAsset.create({ data: { id, userId: (res.locals.identity as Identity).user.id, name: input.data.name, contentType: input.data.contentType, bytes: input.data.size, originalPath } });
  res.json({ uploadId: row.id, uploadURL: `/api/storage/uploads/${row.id}`, objectPath: originalPath });
});
router.put("/storage/uploads/:id", requireStaff, uploadLimit, raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: MAX_PHOTO_BYTES }), async (req, res): Promise<void> => {
  const params = PutMediaUploadParams.safeParse(req.params);
  if (!params.success || !Buffer.isBuffer(req.body)) { res.status(400).json({ error: "Transfert de photo invalide." }); return; }
  const store = await resolveStore();
  if (!store) { res.status(503).json({ error: "Dossier des photos Hostinger indisponible." }); return; }
  const who = res.locals.identity as Identity;
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM media_assets WHERE id = ${params.data.id} FOR UPDATE`;
    const row = await tx.mediaAsset.findUnique({ where: { id: params.data.id } });
    if (!row || row.userId !== who.user.id) throw Object.assign(new Error("Transfert introuvable."), { status: 404 });
    if (row.status !== "PENDING") throw Object.assign(new Error("Ce transfert a déjà été reçu ou clôturé. Créez un nouveau transfert."), { status: 409 });
    if (Date.now() - row.createdAt.getTime() > 15 * 60 * 1000) throw Object.assign(new Error("Transfert expiré. Réessayez depuis la médiathèque."), { status: 410 });
    if (req.body.length !== row.bytes || !req.is(row.contentType)) throw Object.assign(new Error("Le format ou la taille ne correspond pas au fichier annoncé."), { status: 400 });
    await store.write(row.originalPath, req.body);
    await tx.mediaAsset.update({ where: { id: row.id }, data: { status: "UPLOADED" } });
  });
  res.json({ message: "Photo reçue en privé, en attente de validation." });
});
router.post("/admin/media/:id/complete", uploadLimit, async (req, res): Promise<void> => {
  const params = CompleteMediaParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Image invalide." }); return; }
  const row = await db.mediaAsset.findUnique({ where: { id: params.data.id } });
  if (!row || row.status === "DELETED") { res.status(404).json({ error: "Image introuvable." }); return; }
  if (row.status === "READY") { res.json(mediaOutput(row)); return; }
  if (row.userId !== (res.locals.identity as Identity).user.id) { res.status(404).json({ error: "Transfert introuvable." }); return; }
  if (row.status !== "UPLOADED") { res.status(409).json({ error: "Le transfert n'est pas terminé." }); return; }
  const store = await resolveStore();
  if (!store) { res.status(503).json({ error: "Dossier des photos Hostinger indisponible." }); return; }
  let processed;
  try { processed = await processStoredPhoto(row, store); }
  catch (error) {
    const status = (error as { status?: number }).status;
    res.status(status === 400 ? 400 : 503).json({ error: status === 400 ? (error as Error).message : "Le fichier n'a pas pu être validé. Vérifiez la fin du transfert ou réessayez." }); return;
  }
  const userId = (res.locals.identity as Identity).user.id;
  const ready = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM media_assets WHERE id = ${row.id} FOR UPDATE`;
    const current = await tx.mediaAsset.findUniqueOrThrow({ where: { id: row.id } });
    if (current.status === "READY") return current;
    if (current.status !== "UPLOADED") throw Object.assign(new Error("Image supprimée pendant le traitement."), { status: 409 });
    const updated = await tx.mediaAsset.update({ where: { id: row.id }, data: { ...processed, status: "READY", contentType: "image/webp" } });
    await tx.auditLog.create({ data: { userId, action: "IMAGE_UPLOADED", detail: `Photo validée et optimisée : ${row.name}` } });
    return updated;
  });
  res.json(mediaOutput(ready));
});
router.delete("/admin/media/:id", async (req, res): Promise<void> => {
  const params = DeleteMediaParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Image invalide." }); return; }
  const userId = (res.locals.identity as Identity).user.id;
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM media_assets WHERE id = ${params.data.id} FOR UPDATE`;
    const row = await tx.mediaAsset.findUnique({ where: { id: params.data.id } });
    if (!row) throw Object.assign(new Error("Image introuvable."), { status: 404 });
    if (await tx.productImage.count({ where: { mediaId: row.id } })) throw Object.assign(new Error("Cette image est utilisée par un produit. Retirez-la de ses produits avant de la supprimer."), { status: 409 });
    if (row.status !== "DELETED") {
      await tx.mediaAsset.update({ where: { id: row.id }, data: { status: "DELETED" } });
      await tx.auditLog.create({ data: { userId, action: "IMAGE_DELETED", detail: `Photo retirée de la médiathèque : ${row.name}` } });
    }
  });
  res.json({ message: "Photo retirée de la médiathèque et de la diffusion." });
});
router.get("/media/:id/:version", async (req, res): Promise<void> => {
  const id = String(req.params.id), version = String(req.params.version);
  if (!/^[a-f0-9-]{36}$/.test(id) || !["image", "thumbnail"].includes(version)) { res.sendStatus(404); return; }
  const row = await db.mediaAsset.findUnique({ where: { id } });
  if (!row || row.status !== "READY") { res.sendStatus(404); return; }
  const publicUse = await db.productImage.findFirst({ where: { mediaId: id, product: { status: { in: ["PREVIEW", "ACTIVE"] } } }, select: { id: true } });
  if (!publicUse) {
    const who = await identity(req);
    if (!who || who.user.mustChangePassword || !["STORE_OWNER", "MANAGER"].includes(who.user.role)) { res.sendStatus(404); return; }
  }
  const store = await resolveStore();
  if (!store) { res.status(503).json({ error: "Dossier des photos Hostinger indisponible." }); return; }
  res.setHeader("Content-Type", "image/webp");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-cache");
  store.stream(`${row.objectPrefix}/${version}.webp`).on("error", () => {
    if (!res.headersSent) res.status(503).end();
    else res.destroy();
  }).pipe(res);
});
return router;
}
export default createMediaRouter();
