import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { buffer } from "node:stream/consumers";
import type { MediaAsset } from "@prisma/client";
import { ObjectStorageService, objectStorageClient } from "./objectStorage";

export const storageService = new ObjectStorageService();
export const storageEnabled = () => !!process.env.PRIVATE_OBJECT_DIR;
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
export function mediaOutput(row: MediaAsset) {
  return { id: row.id, name: row.name, path: `/api/media/${row.id}/image`, thumbnailPath: `/api/media/${row.id}/thumbnail`, width: row.width, height: row.height, bytes: row.bytes };
}
export function mediaFile(relativePath: string) {
  const [bucketName, ...prefix] = storageService.getPrivateObjectDir().replace(/^\/+/, "").split("/");
  if (!bucketName || !prefix.length) throw new Error("STORAGE_CONFIGURATION");
  return objectStorageClient.bucket(bucketName).file(`${prefix.join("/")}/${relativePath}`);
}
export async function optimizePhoto(bytes: Buffer) {
  if (!bytes.length || bytes.length > MAX_PHOTO_BYTES) throw Object.assign(new Error("Image trop volumineuse (8 Mio maximum)."), { status: 400 });
  const image = sharp(bytes, { limitInputPixels: 20000000, failOn: "error" });
  let meta;
  try { meta = await image.metadata(); } catch { throw Object.assign(new Error("Le fichier n'est pas une image valide."), { status: 400 }); }
  if (!["jpeg", "png", "webp"].includes(meta.format || "") || (meta.pages || 1) > 1) throw Object.assign(new Error("Seules les photos JPEG, PNG ou WebP non animées sont acceptées."), { status: 400 });
  const full = await image.clone().rotate().resize({ width: 1600, height: 2400, fit: "inside", withoutEnlargement: true }).webp({ quality: 85 }).toBuffer({ resolveWithObject: true });
  const thumbnail = await image.clone().rotate().resize({ width: 400, height: 600, fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
  return { image: full.data, thumbnail, width: full.info.width, height: full.info.height };
}
export async function processStoredPhoto(row: MediaAsset) {
  const source = await storageService.getObjectEntityFile(row.originalPath);
  const [meta] = await source.getMetadata();
  const size = Number(meta.size);
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_PHOTO_BYTES) throw Object.assign(new Error("Image trop volumineuse (8 Mio maximum)."), { status: 400 });
  const bytes = await buffer(source.createReadStream({ start: 0, end: MAX_PHOTO_BYTES }));
  const result = await optimizePhoto(bytes);
  const objectPrefix = `processed/${row.id}/${randomUUID()}`;
  const options = { resumable: false, metadata: { contentType: "image/webp", cacheControl: "private, max-age=0", metadata: { owner: String(row.userId) } } };
  await Promise.all([
    mediaFile(`${objectPrefix}/image.webp`).save(result.image, options),
    mediaFile(`${objectPrefix}/thumbnail.webp`).save(result.thumbnail, options),
  ]);
  return { objectPrefix, width: result.width, height: result.height, bytes: result.image.length };
}
