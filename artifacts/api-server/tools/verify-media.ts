import assert from "node:assert/strict";
import sharp from "sharp";
import { optimizePhoto } from "../src/lib/media";

const fixture = await sharp({ create: { width: 2000, height: 3000, channels: 3, background: "#f4c9d9" } }).png().toBuffer();
const result = await optimizePhoto(fixture);
assert.equal(result.width, 1600); assert.equal(result.height, 2400);
assert.equal((await sharp(result.image).metadata()).format, "webp");
const thumb = await sharp(result.thumbnail).metadata();
assert.equal(thumb.width, 400); assert.equal(thumb.height, 600);
await assert.rejects(optimizePhoto(Buffer.from("<svg><script>alert(1)</script></svg>")), /image valide|acceptées/);
await assert.rejects(optimizePhoto(Buffer.alloc(8 * 1024 * 1024 + 1)), /volumineuse/);
console.log("PASS: photo validation, oversized/SVG rejection, uncropped optimization and WebP thumbnail. This does not verify cloud uploads.");
