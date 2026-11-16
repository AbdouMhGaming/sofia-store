import sharp from "sharp";
import { randomUUID } from "node:crypto";
import type { MediaAsset } from "@prisma/client";
import { MAX_PHOTO_BYTES, type DiskMediaStore } from "./media-disk";

export { MAX_PHOTO_BYTES } from "./media-disk";
export function mediaOutput(row: MediaAsset) {
  return { id: row.id, name: row.name, path: `/api/media/${row.id}/image`, thumbnailPath: `/api/media/${row.id}/thumbnail`, width: row.width, height: row.height, bytes: row.bytes };
}
export async function optimizePhoto(bytes: Buffer) {
  if (!bytes.length || bytes.length > MAX_PHOTO_BYTES) throw Object.assign(new Error("Image trop volumineuse (8 Mio maximum)."), { status: 400 });
  const image = sharp(bytes, { limitInputPixels: 20000000, failOn: "error" });
  let meta;
  try { meta = await image.metadata(); } catch { throw Object.assign(new Error("Le fichier n'est pas une image valide."), { status: 400 }); }
  if (!["jpeg", "png", "webp"].includes(meta.format || "") || (meta.pages || 1) > 1) throw Object.assign(new Error("Seules les photos JPEG, PNG ou WebP non animées sont acceptées."), { status: 400 });
  try {
    const full = await image.clone().rotate().resize({ width: 1600, height: 2400, fit: "inside", withoutEnlargement: true }).webp({ quality: 85 }).toBuffer({ resolveWithObject: true });
    const thumbnail = await image.clone().rotate().resize({ width: 400, height: 600, fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
    return { image: full.data, thumbnail, width: full.info.width, height: full.info.height };
  } catch { throw Object.assign(new Error("Le fichier contient une image endommagée ou non prise en charge."), { status: 400 }); }
}
export async function processStoredPhoto(row: MediaAsset, store: DiskMediaStore) {
  const bytes = await store.read(row.originalPath);
  const result = await optimizePhoto(bytes);
  const objectPrefix = `processed/${row.id}/${randomUUID()}`;
  await Promise.all([
    store.write(`${objectPrefix}/image.webp`, result.image),
    store.write(`${objectPrefix}/thumbnail.webp`, result.thumbnail),
  ]);
  return { objectPrefix, width: result.width, height: result.height, bytes: result.image.length };
}
