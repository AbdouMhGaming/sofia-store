import { WebOrderStatus, WebOrderOperation, type WebOrderAction, type WebOrderPaymentInput } from "@workspace/api-client-react";
import { storeRead, storeWrite } from "@/lib/pos";

/** One unresolved admin order command per operator, bound to exact order + user + endpoint. */
export type PendingOp =
  | { orderId: number; userId: number; kind: "ACTION"; body: WebOrderAction }
  | { orderId: number; userId: number; kind: "PAYMENT"; body: WebOrderPaymentInput };

export const pendingOpKey = (userId: number) => `sofia-weborder-pending:${userId}`;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isId = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 1;
const isMoney = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 1_000_000_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const exactKeys = (o: Record<string, unknown>, keys: string[]) => {
  const k = Object.keys(o);
  return k.length === keys.length && keys.every((x) => Object.prototype.hasOwnProperty.call(o, x));
};
const STATUSES = Object.values(WebOrderStatus) as string[];
const OPS = Object.values(WebOrderOperation) as string[];
const str = (v: unknown, max: number, min = 0) => typeof v === "string" && v.length >= min && v.length <= max;

function validAction(b: Record<string, unknown>): boolean {
  if (!exactKeys(b, ["requestId", "expectedStatus", "action", "reason", "collector", "carrierName", "trackingNumber", "restockVariantIds"])) return false;
  if (!(typeof b.requestId === "string" && UUID.test(b.requestId)) || !STATUSES.includes(b.expectedStatus as string) || !OPS.includes(b.action as string)) return false;
  if (!str(b.reason, 500, 3) || !str(b.carrierName, 150) || !str(b.trackingNumber, 150)) return false;
  if (!(b.collector === null || b.collector === "STAFF" || b.collector === "COURIER")) return false;
  if (b.action === "CONFIRM" ? b.collector === null : b.collector !== null) return false;
  if (b.action !== "DISPATCH" && (b.carrierName !== "" || b.trackingNumber !== "")) return false;
  const r = b.restockVariantIds;
  if (b.action === "RETURN_RECEIVE") return Array.isArray(r) && r.length <= 20 && r.every(isId) && new Set(r).size === r.length;
  return r === null;
}

function validPayment(b: Record<string, unknown>): boolean {
  if (!exactKeys(b, ["requestId", "expectedStatus", "kind", "method", "amountMinor", "feeMinor", "feeRefundMinor", "tenderedMinor", "registerSessionId", "reference", "reason"])) return false;
  if (!(typeof b.requestId === "string" && UUID.test(b.requestId)) || !STATUSES.includes(b.expectedStatus as string)) return false;
  if (!(b.kind === "RECEIPT" || b.kind === "REFUND") || !(b.method === "CASH" || b.method === "BANK")) return false;
  if (!isMoney(b.amountMinor) || !isMoney(b.feeMinor) || !isMoney(b.feeRefundMinor) || !str(b.reference, 150) || !str(b.reason, 500, 3)) return false;
  if (b.kind === "RECEIPT" && b.feeRefundMinor !== 0) return false;
  if (b.kind === "REFUND" && (b.feeMinor !== 0 || b.tenderedMinor !== null || (b.feeRefundMinor as number) > (b.amountMinor as number))) return false;
  if (b.method === "CASH") {
    if (!isId(b.registerSessionId) || b.reference !== "") return false;
    if (b.kind === "RECEIPT" && !(isMoney(b.tenderedMinor) && (b.tenderedMinor as number) >= (b.amountMinor as number))) return false;
  } else if (b.tenderedMinor !== null || b.registerSessionId !== null || (b.reference as string).trim().length < 3) return false;
  return true;
}

/** Whole-payload shape check, bound to the expected operator. */
export function validPendingFor(userId: number) {
  return (v: unknown): boolean => {
    if (!isObj(v) || !exactKeys(v, ["orderId", "userId", "kind", "body"]) || !isId(v.orderId) || v.userId !== userId || !isObj(v.body)) return false;
    if (v.kind === "ACTION") return validAction(v.body);
    if (v.kind === "PAYMENT") return validPayment(v.body);
    return false;
  };
}

export const readPendingOp = (userId: number) => storeRead<PendingOp>(pendingOpKey(userId), validPendingFor(userId));

/** Writes and verifies the exact bytes read back match and still validate. */
export function writePendingOp(userId: number, p: PendingOp): boolean {
  if (!validPendingFor(userId)(p)) return false;
  if (!storeWrite(pendingOpKey(userId), p)) return false;
  const back = readPendingOp(userId);
  return back.ok && !!back.value && JSON.stringify(back.value) === JSON.stringify(p);
}

/** Before any retry: storage must still hold exactly this request. */
export function storedMatches(userId: number, p: PendingOp): boolean {
  const back = readPendingOp(userId);
  return back.ok && !!back.value && JSON.stringify(back.value) === JSON.stringify(p);
}

export const clearPendingOp = (userId: number) => storeWrite(pendingOpKey(userId), null);
