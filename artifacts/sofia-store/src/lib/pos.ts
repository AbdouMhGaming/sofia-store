import { useQueryClient } from "@tanstack/react-query";
import { useGetPosContext, getGetPosContextQueryKey, type PosVariant, type CashSaleInput, type RefundInput } from "@workspace/api-client-react";
import { useSessionCsrf } from "@/lib/auth";
import { daToMinor } from "@/lib/util";

export const MAX_MINOR = 1_000_000_000;
export const MAX_LINES = 50;
export const MAX_QTY = 1000;

/** Parses a DA amount typed by staff into exact integer centimes in 0..1e9, or null. */
export function parseMoney(input: string): number | null {
  if (!input.trim()) return null;
  const v = daToMinor(input);
  if (v === null || !Number.isSafeInteger(v) || v < 0 || v > MAX_MINOR) return null;
  return v;
}

export function newRequestId(): string {
  const c = globalThis.crypto;
  if (typeof c.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

const ALG = new Intl.DateTimeFormat("fr-FR", { timeZone: "Africa/Algiers", dateStyle: "short", timeStyle: "short" });
const ALG_LONG = new Intl.DateTimeFormat("fr-FR", { timeZone: "Africa/Algiers", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
export const fmtDate = (iso: string) => ALG.format(new Date(iso));
export const fmtDateLong = (iso: string) => ALG_LONG.format(new Date(iso));

export type Outcome = "uncertain" | "rejected" | "conflict" | "auth";
/** Classifies a failed financial mutation. Anything without a definite pre-commit answer is uncertain. */
export function classify(e: unknown): Outcome {
  const s = (e as { status?: number } | null)?.status;
  if (typeof s !== "number") return "uncertain";
  if (s === 409) return "conflict";
  if (s === 401) return "auth";
  if (s === 400 || s === 403 || s === 422 || s === 404) return "rejected";
  return "uncertain";
}
export const statusOf = (e: unknown) => (e as { status?: number } | null)?.status;

/** Session + POS context with the shared enable guard. */
export function usePos() {
  const { session, request } = useSessionCsrf();
  const user = session.data?.user ?? null;
  const enabled = !!user && !user.mustChangePassword;
  const ctx = useGetPosContext({ query: { queryKey: getGetPosContextQueryKey(), enabled, refetchInterval: 20_000 } });
  return { session, request, user, enabled, ctx };
}

/** Invalidate POS + admin inventory/summary/activity/movement data after financial mutations. */
export function useInvalidatePos() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({
    predicate: (q) => {
      const k = String(q.queryKey[0] ?? "");
      return k.includes("/pos") || k.startsWith("/api/admin") || k.startsWith("/api/inventory") || k.includes("movements") || k.includes("activity") || k.startsWith("/api/products");
    },
  });
}

/* ---------- Per-user session draft ---------- */

export interface BasketLine { variant: PosVariant; quantity: number; discountMinor: number }
export interface PosDraft {
  lines: BasketLine[];
  orderDiscountMinor: number;
  discountReason: string;
  pending: CashSaleInput | null;
}
export const emptyDraft = (): PosDraft => ({ lines: [], orderDiscountMinor: 0, discountReason: "", pending: null });

/* ---------- Fail-closed storage helpers ---------- */

export type StoreRead<T> = { ok: true; value: T | null } | { ok: false };
export const STORAGE_WRITE_ERROR = "Impossible d'enregistrer la demande dans cet onglet (stockage du navigateur bloqué ou plein). Rien n'a été envoyé. Libérez le stockage ou autorisez-le, puis réessayez.";
export const STORAGE_CLEANUP_WARNING = "Opération confirmée, mais l'onglet n'a pas pu effacer sa copie locale. Au rechargement, utilisez « Vérifier » : aucun nouvel envoi ne sera fait automatiquement.";
export const STORAGE_CORRUPT_MESSAGE = "Une demande financière enregistrée dans cet onglet est illisible. Par sécurité, elle n'a pas été effacée et aucune nouvelle opération n'est possible ici. Vérifiez l'historique des tickets et des sessions, puis faites intervenir un responsable avant de continuer.";

/** Reads JSON; missing key = ok/null; unreadable or invalid shape = not ok (never auto-deleted). */
export function storeRead<T>(key: string, valid: (v: unknown) => boolean): StoreRead<T> {
  let raw: string | null;
  try { raw = sessionStorage.getItem(key); } catch { return { ok: false }; }
  if (raw === null) return { ok: true, value: null };
  try {
    const v = JSON.parse(raw);
    if (v === null) return { ok: true, value: null };
    return valid(v) ? { ok: true, value: v as T } : { ok: false };
  } catch { return { ok: false }; }
}
/** Writes (or removes when null) and verifies by reading back. Returns false on any failure. */
export function storeWrite(key: string, value: unknown): boolean {
  try {
    if (value === null) { sessionStorage.removeItem(key); return sessionStorage.getItem(key) === null; }
    const raw = JSON.stringify(value);
    sessionStorage.setItem(key, raw);
    return sessionStorage.getItem(key) === raw;
  } catch { return false; }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isInt = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v);
const isReqId = (v: unknown) => typeof v === "string" && v.length >= 16 && v.length <= 100;
const validSalePayload = (v: unknown) => isObj(v) && isReqId(v.requestId) && isInt(v.registerSessionId) && Array.isArray(v.items)
  && v.items.every((i) => isObj(i) && isInt(i.variantId) && isInt(i.quantity) && isInt(i.expectedUnitPriceMinor) && isInt(i.discountMinor))
  && isInt(v.orderDiscountMinor) && typeof v.discountReason === "string" && isInt(v.tenderedMinor);
const validDraft = (v: unknown) => isObj(v) && Array.isArray(v.lines)
  && v.lines.every((l) => isObj(l) && isObj(l.variant) && isInt(l.variant.id) && isInt(l.variant.priceMinor) && isInt(l.quantity) && isInt(l.discountMinor))
  && isInt(v.orderDiscountMinor ?? 0) && typeof (v.discountReason ?? "") === "string"
  && (v.pending == null || validSalePayload(v.pending));
const validRefund = (v: unknown) => isObj(v) && isReqId(v.requestId) && isInt(v.registerSessionId) && (v.kind === "RETURN" || v.kind === "VOID")
  && typeof v.reason === "string" && Array.isArray(v.items) && v.items.every((i) => isObj(i) && isInt(i.saleItemId) && isInt(i.quantity) && typeof i.restock === "boolean");
export const validOpening = (v: unknown) => isObj(v) && isReqId(v.requestId) && isInt(v.openingMinor);
export const validClosing = (v: unknown) => isObj(v) && isReqId(v.requestId) && isInt(v.countedMinor) && typeof v.reason === "string";

const draftKey = (userId: number) => `sofia-pos-draft:${userId}`;
export function loadDraft(userId: number): StoreRead<PosDraft> {
  const r = storeRead<PosDraft>(draftKey(userId), validDraft);
  if (!r.ok) return r;
  return { ok: true, value: r.value ? { ...emptyDraft(), ...r.value } : emptyDraft() };
}
export const saveDraft = (userId: number, d: PosDraft) => storeWrite(draftKey(userId), d);

const refundKey = (userId: number, saleId: number) => `sofia-pos-refund:${userId}:${saleId}`;
export const loadPendingRefund = (userId: number, saleId: number) => storeRead<RefundInput>(refundKey(userId, saleId), validRefund);
export const savePendingRefund = (userId: number, saleId: number, r: RefundInput | null) => storeWrite(refundKey(userId, saleId), r);

export function basketTotals(d: Pick<PosDraft, "lines" | "orderDiscountMinor">) {
  let gross = 0, lineDisc = 0;
  for (const l of d.lines) { gross += l.variant.priceMinor * l.quantity; lineDisc += l.discountMinor; }
  const afterLines = gross - lineDisc;
  const net = afterLines - d.orderDiscountMinor;
  const units = d.lines.reduce((a, l) => a + l.quantity, 0);
  return { gross, lineDisc, afterLines, net, units, discounts: lineDisc + d.orderDiscountMinor };
}

/** Cumulative refund estimate; backend is authoritative. */
export function refundEstimate(lineTotal: number, originalQty: number, already: number, add: number) {
  if (originalQty <= 0 || add <= 0) return 0;
  return Math.floor((lineTotal * (already + add)) / originalQty) - Math.floor((lineTotal * already) / originalQty);
}

export const SALE_STATUS: Record<string, [string, string]> = {
  COMPLETED: ["Encaissée", "bg-[#f7e6ec] text-[#a82d64]"],
  PARTIALLY_REFUNDED: ["Remboursée en partie", "bg-[#fbf1ea] text-[#a65429]"],
  REFUNDED: ["Remboursée", "bg-muted text-muted-foreground"],
  VOIDED: ["Annulée", "bg-destructive/10 text-destructive"],
};
export const REFUND_KIND: Record<string, string> = { RETURN: "Retour", VOID: "Annulation", REFUND: "Remboursement" };

/* ---------- Per-user pending opening/closing ---------- */
export const openingKey = (userId: number) => `sofia-pos-opening:${userId}`;
export const closingKey = (userId: number, sessionId: number) => `sofia-pos-closing:${userId}:${sessionId}`;
