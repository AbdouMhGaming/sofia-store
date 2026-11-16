import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, realpath, rename, stat, unlink } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const uuid = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
const keyPattern = new RegExp(`^(pending/${uuid}/source|processed/${uuid}/${uuid}/(image|thumbnail)\\.webp)$`);
const inside = (parent: string, path: string) => {
  const result = relative(parent, path);
  return !result || (result !== ".." && !result.startsWith(`..${sep}`) && !isAbsolute(result));
};

/** A configuration guard, not a claim about a hosting account's permissions. */
export function validateUploadRoot(root: string, appDirectory = process.cwd()) {
  if (!isAbsolute(root) || root === resolve(root, "..")) throw new Error("UPLOAD_ROOT_MUST_BE_ABSOLUTE_PRIVATE_DIRECTORY");
  const parts = resolve(root).split(sep).map(p => p.toLowerCase());
  if (parts.some(p => ["hbuilds", "public_html", "node_modules", ".git"].includes(p)) ||
      ["/tmp", "/var/tmp", "/run", "/proc", "/sys", "/dev"].some(p => inside(p, resolve(root))) ||
      inside(resolve(appDirectory), resolve(root))) {
    throw new Error("UPLOAD_ROOT_MUST_BE_OUTSIDE_TEMPORARY_OR_DEPLOYED_FILES");
  }
}

/** Explicit root injection lets tests use disposable fixtures without configuring
 * the running app to store real customer uploads on temporary Replit disk. */
export class DiskMediaStore {
  constructor(readonly root: string) {
    if (!isAbsolute(root)) throw new Error("ABSOLUTE_UPLOAD_ROOT_REQUIRED");
  }
  private path(key: string) {
    if (!keyPattern.test(key)) throw new Error("INVALID_MEDIA_STORAGE_KEY");
    return resolve(this.root, key);
  }
  async initialize() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const marker = resolve(this.root, `.write-check-${randomUUID()}`);
    const handle = await open(marker, "wx", 0o600);
    await handle.close();
    await unlink(marker);
  }
  async write(key: string, bytes: Buffer) {
    if (!bytes.length || bytes.length > MAX_PHOTO_BYTES) throw Object.assign(new Error("Image trop volumineuse ou vide."), { status: 400 });
    const destination = this.path(key);
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    const temporary = `${destination}.${randomUUID()}.tmp`;
    const handle = await open(temporary, "wx", 0o600);
    try {
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally { await handle.close(); }
      await rename(temporary, destination);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }
  async read(key: string) {
    const file = this.path(key);
    const metadata = await stat(file);
    if (!metadata.isFile() || metadata.size < 1 || metadata.size > MAX_PHOTO_BYTES) throw Object.assign(new Error("Image trop volumineuse ou vide."), { status: 400 });
    return readFile(file);
  }
  stream(key: string) { return createReadStream(this.path(key)); }
}

let cachedRoot: string | undefined;
let initialization: Promise<DiskMediaStore | null> | undefined;
export async function getMediaStore(): Promise<DiskMediaStore | null> {
  const configured = process.env.SOFIA_UPLOAD_DIR;
  if (!configured) return null;
  if (configured !== cachedRoot || !initialization) {
    cachedRoot = configured;
    initialization = (async () => {
      validateUploadRoot(configured);
      await mkdir(configured, { recursive: true, mode: 0o700 });
      const canonical = await realpath(configured);
      validateUploadRoot(canonical);
      const store = new DiskMediaStore(canonical);
      await store.initialize();
      return store;
    })().catch((error: unknown) => {
      // Never expose the account's filesystem paths or silently use temporary disk.
      console.warn("Persistent media directory unavailable:", (error as { code?: string }).code || "INVALID_UPLOAD_DIRECTORY");
      initialization = undefined;
      return null;
    });
  }
  return initialization;
}
