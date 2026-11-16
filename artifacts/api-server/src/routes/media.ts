import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import { db } from "@workspace/db";
import { RequestUploadUrlBody, CompleteMediaParams, DeleteMediaParams, ListMediaResponse } from "@workspace/api-zod";
import { requireStaff, identity, type Identity } from "../lib/security";
import { storageEnabled, storageService, mediaOutput, mediaFile, processStoredPhoto } from "../lib/media";

const router: IRouter = Router();
const uploadLimit = rateLimit({ windowMs: 10 * 60 * 1000, limit: 40, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "Trop de demandes d'images. Réessayez plus tard." } });
router.get("/admin/media", async (_req, res): Promise<void> => {
  const rows = await db.mediaAsset.findMany({ where: { status: "READY" }, orderBy: { createdAt: "desc" }, take: 500 });
  res.json(ListMediaResponse.parse({ enabled: storageEnabled(), items: rows.map(mediaOutput) }));
});
router.post("/storage/uploads/request-url", requireStaff, uploadLimit, async (req, res): Promise<void> => {
  const input = RequestUploadUrlBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Photo invalide : JPEG, PNG ou WebP de 8 Mio maximum." }); return; }
  if (!storageEnabled()) { res.status(503).json({ error: "Stockage persistant non connecté. Aucun fichier temporaire n'a été enregistré." }); return; }
  let uploadURL: string;
  try { uploadURL = await storageService.getObjectEntityUploadURL(); }
  catch { res.status(503).json({ error: "Le service de stockage est indisponible. Réessayez plus tard." }); return; }
  const originalPath = storageService.normalizeObjectEntityPath(uploadURL);
  if (!originalPath.startsWith("/objects/uploads/")) { res.status(503).json({ error: "Configuration du stockage invalide." }); return; }
  const row = await db.mediaAsset.create({ data: { id: randomUUID(), userId: (res.locals.identity as Identity).user.id, name: input.data.name, contentType: input.data.contentType, originalPath } });
  res.json({ uploadId: row.id, uploadURL, objectPath: originalPath });
});
router.post("/admin/media/:id/complete", uploadLimit, async (req, res): Promise<void> => {
  const params = CompleteMediaParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Image invalide." }); return; }
  const row = await db.mediaAsset.findUnique({ where: { id: params.data.id } });
  if (!row || row.status === "DELETED") { res.status(404).json({ error: "Image introuvable." }); return; }
  if (row.status === "READY") { res.json(mediaOutput(row)); return; }
  if (!storageEnabled()) { res.status(503).json({ error: "Stockage persistant non connecté." }); return; }
  let processed;
  try { processed = await processStoredPhoto(row); }
  catch (error) {
    const status = (error as { status?: number }).status;
    res.status(status === 400 ? 400 : 503).json({ error: status === 400 ? (error as Error).message : "Le fichier n'a pas pu être validé. Vérifiez la fin du transfert ou réessayez." }); return;
  }
  const userId = (res.locals.identity as Identity).user.id;
  const ready = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM media_assets WHERE id = ${row.id} FOR UPDATE`;
    const current = await tx.mediaAsset.findUniqueOrThrow({ where: { id: row.id } });
    if (current.status === "READY") return current;
    if (current.status !== "PENDING") throw Object.assign(new Error("Image supprimée pendant le traitement."), { status: 409 });
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
  if (!storageEnabled()) { res.status(503).json({ error: "Stockage indisponible." }); return; }
  const file = mediaFile(`${row.objectPrefix}/${version}.webp`);
  res.setHeader("Content-Type", "image/webp");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-cache");
  file.createReadStream().on("error", () => {
    if (!res.headersSent) res.status(503).end();
    else res.destroy();
  }).pipe(res);
});
export default router;
