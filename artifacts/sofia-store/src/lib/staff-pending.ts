import type { StaffCommandInput } from "@workspace/api-client-react";

/** Only the non-secret command INPUT is ever persisted. Never results, never passwords. */
const PREFIX = "sofia-staff-pending:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES = new Set(["MANAGER", "CASHIER"]);
const MAX_RAW = 2000;

export type PendingRead = { state: "none" } | { state: "ok"; input: StaffCommandInput } | { state: "bad"; why: string };

const key = (actorId: number) => `${PREFIX}${actorId}`;
const isId = (n: unknown) => typeof n === "number" && Number.isSafeInteger(n) && n >= 1;
const isReason = (r: unknown) => typeof r === "string" && r.trim().length >= 3 && r.length <= 400;
const exactKeys = (o: Record<string, unknown>, keys: string[]) => {
  const k = Object.keys(o).sort();
  return k.length === keys.length && [...keys].sort().every((x, i) => x === k[i]);
};

export function validateInput(v: unknown): StaffCommandInput | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.requestId !== "string" || !UUID.test(o.requestId) || !isReason(o.reason)) return null;
  if (o.kind === "CREATE") {
    if (!exactKeys(o, ["kind", "requestId", "email", "role", "reason"])) return null;
    if (typeof o.email !== "string" || o.email.length > 190 || !EMAIL.test(o.email) || !ROLES.has(o.role as string)) return null;
  } else if (o.kind === "UPDATE") {
    if (!exactKeys(o, ["kind", "requestId", "userId", "version", "role", "active", "reason"])) return null;
    if (!isId(o.userId) || !isId(o.version) || !ROLES.has(o.role as string) || typeof o.active !== "boolean") return null;
  } else if (o.kind === "RESET") {
    if (!exactKeys(o, ["kind", "requestId", "userId", "version", "reason"])) return null;
    if (!isId(o.userId) || !isId(o.version)) return null;
  } else return null;
  return o as unknown as StaffCommandInput;
}

export function readPending(actorId: number): PendingRead {
  let raw: string | null;
  try { raw = localStorage.getItem(key(actorId)); } catch { return { state: "bad", why: "Stockage local illisible sur cet appareil." }; }
  if (raw === null) return { state: "none" };
  if (raw.length > MAX_RAW) return { state: "bad", why: "Trace d'opération trop volumineuse." };
  try {
    const p = JSON.parse(raw) as Record<string, unknown>;
    if (!p || typeof p !== "object" || !exactKeys(p, ["v", "actorId", "input"]) || p.v !== 1 || p.actorId !== actorId) {
      return { state: "bad", why: "Trace d'opération de forme inattendue." };
    }
    const input = validateInput(p.input);
    return input ? { state: "ok", input } : { state: "bad", why: "Trace d'opération invalide." };
  } catch { return { state: "bad", why: "Trace d'opération corrompue." }; }
}

export const pendingKey = key;

type LockMgr = { request: (name: string, opts: { mode: "exclusive" }, cb: () => Promise<unknown>) => Promise<unknown> };
function locks(): LockMgr | null {
  const l = (typeof navigator !== "undefined" ? (navigator as unknown as { locks?: LockMgr }).locks : undefined);
  return typeof window !== "undefined" && window.isSecureContext && l && typeof l.request === "function" ? l : null;
}
async function withLock<T>(actorId: number, fn: () => T): Promise<T | "nolock"> {
  const l = locks();
  if (!l) return "nolock";
  let out!: T;
  await l.request(`sofia-staff-pending-lock:${actorId}`, { mode: "exclusive" }, async () => { out = fn(); });
  return out;
}

export type SaveResult = { ok: true } | { ok: false; reason: "locks" | "exists" | "storage" };

/** Serialized across tabs. Refuses any existing marker; writes then reads back exactly. */
export async function savePending(actorId: number, input: StaffCommandInput): Promise<SaveResult> {
  if (!validateInput(input)) return { ok: false, reason: "storage" };
  try {
    const r = await withLock<SaveResult>(actorId, () => {
      const cur = readPending(actorId);
      if (cur.state !== "none") return { ok: false, reason: "exists" };
      const raw = JSON.stringify({ v: 1, actorId, input });
      try {
        localStorage.setItem(key(actorId), raw);
        return localStorage.getItem(key(actorId)) === raw ? { ok: true } : { ok: false, reason: "storage" };
      } catch { return { ok: false, reason: "storage" }; }
    });
    return r === "nolock" ? { ok: false, reason: "locks" } : r;
  } catch { return { ok: false, reason: "locks" }; }
}

/** Removes the marker only if it is EXACTLY the confirmed input. A different or unreadable marker is never touched. */
export async function clearPending(actorId: number, confirmed: StaffCommandInput): Promise<boolean> {
  try {
    const r = await withLock<boolean>(actorId, () => {
      const cur = readPending(actorId);
      if (cur.state === "none") return true;
      if (cur.state === "bad") return true; // confirmed input not readable there; leave it, UI stays blocked
      if (!sameInput(cur.input, confirmed)) return true; // another command: preserve
      try {
        localStorage.removeItem(key(actorId));
        return localStorage.getItem(key(actorId)) === null;
      } catch { return false; }
    });
    return r === true;
  } catch { return false; }
}

export function sameInput(a: StaffCommandInput, b: StaffCommandInput) {
  const norm = (x: StaffCommandInput) => JSON.stringify(Object.keys(x).sort().map((k) => [k, (x as unknown as Record<string, unknown>)[k]]));
  return norm(a) === norm(b);
}
