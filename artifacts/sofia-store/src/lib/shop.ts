import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetCheckoutConfig, getGetCheckoutConfigQueryKey,
  type CheckoutAccess, type CheckoutSubmission, type Product, type Variant,
} from "@workspace/api-client-react";
import { useI18n } from "@/lib/i18n";
import { storeRead, storeWrite } from "@/lib/pos";
import { errMsg } from "@/lib/util";

/* ---------- Cart (device-persisted, display snapshot only; server is the authority) ---------- */

export const CART_MAX_LINES = 20;
export const CART_MAX_QTY = 20;
export interface CartLine {
  variantId: number; quantity: number;
  slug: string; nameFr: string; nameAr: string; size: string; color: string; image: string;
  /** Price seen when added; display hint only, rechecked at server quote. */
  priceMinor: number;
}
const CART_KEY = "sofia-cart";
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isInt = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v);
const validLine = (l: unknown) => isObj(l) && isInt(l.variantId) && isInt(l.quantity) && (l.quantity as number) >= 1
  && typeof l.slug === "string" && typeof l.nameFr === "string" && typeof l.nameAr === "string" && isInt(l.priceMinor);

function readCart(): CartLine[] {
  try {
    const v = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
    return Array.isArray(v) ? v.filter(validLine).slice(0, CART_MAX_LINES) : [];
  } catch { return []; }
}
function writeCart(lines: CartLine[]) {
  try { localStorage.setItem(CART_KEY, JSON.stringify(lines)); } catch { /* quota: in-memory only */ }
  window.dispatchEvent(new Event("sofia-cart"));
}

export function useCart() {
  const [lines, setLines] = useState<CartLine[]>(readCart);
  useEffect(() => {
    const h = () => setLines(readCart());
    window.addEventListener("sofia-cart", h);
    window.addEventListener("storage", h);
    return () => { window.removeEventListener("sofia-cart", h); window.removeEventListener("storage", h); };
  }, []);
  const commit = (next: CartLine[]) => { setLines(next); writeCart(next); };
  const add = (p: Product, v: Variant, qty: number): boolean => {
    const cur = readCart();
    const ex = cur.find((l) => l.variantId === v.id);
    if (!ex && cur.length >= CART_MAX_LINES) return false;
    const cap = Math.min(CART_MAX_QTY, Math.max(1, v.available));
    const next = ex
      ? cur.map((l) => l.variantId === v.id ? { ...l, quantity: Math.min(cap, l.quantity + qty), priceMinor: v.priceMinor } : l)
      : [...cur, { variantId: v.id, quantity: Math.min(cap, qty), slug: p.slug, nameFr: p.nameFr, nameAr: p.nameAr, size: v.size, color: v.color, image: p.images[0] ?? "", priceMinor: v.priceMinor }];
    commit(next);
    return true;
  };
  const setQty = (variantId: number, q: number) => commit(readCart().map((l) => l.variantId === variantId ? { ...l, quantity: Math.max(1, Math.min(CART_MAX_QTY, q)) } : l));
  const remove = (variantId: number) => commit(readCart().filter((l) => l.variantId !== variantId));
  const clear = () => commit([]);
  const count = lines.reduce((a, l) => a + l.quantity, 0);
  return { lines, add, setQty, remove, clear, count };
}

export const isBuyable = (p: Product) => p.status === "ACTIVE" && p.variants.some((v) => v.available > 0);
export const fromPrice = (p: Product) => {
  const vs = p.variants.filter((v) => v.available > 0);
  return vs.length ? Math.min(...vs.map((v) => v.priceMinor)) : null;
};

export function useCommerce() {
  const cfg = useGetCheckoutConfig({ query: { queryKey: getGetCheckoutConfigQueryKey(), staleTime: 60_000, retry: 1 } });
  return { cfg, enabled: !!cfg.data?.enabled && (!!cfg.data.deliveryEnabled || !!cfg.data.pickupEnabled) };
}

/* ---------- Crypto ---------- */

export function newUuid(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  throw new Error("crypto.randomUUID unavailable");
}
export function newAccessToken(): string {
  const b = new Uint8Array(32);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/* ---------- Pending submission + tab-scoped confirmation capability ---------- */

export const PENDING_KEY = "sofia-checkout-pending";
export const CONFIRM_KEY = "sofia-checkout-confirmation";
const isHex64 = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
export const validAccess = (v: unknown) => isObj(v) && typeof v.requestId === "string" && v.requestId.length >= 16 && v.requestId.length <= 100 && isHex64(v.accessToken);
export const validSubmission = (v: unknown) => validAccess(v) && isObj(v) && isHex64(v.expectedQuoteHash)
  && Array.isArray(v.items) && v.items.length >= 1 && v.items.every((i) => isObj(i) && isInt(i.variantId) && isInt(i.quantity))
  && (v.fulfillment === "DELIVERY" || v.fulfillment === "PICKUP") && (v.deliveryMode === null || v.deliveryMode === "HOME" || v.deliveryMode === "DESK") && (v.zoneCode === null || typeof v.zoneCode === "string")
  && typeof v.customerName === "string" && typeof v.customerPhone === "string" && typeof v.commune === "string"
  && typeof v.address === "string" && typeof v.notes === "string" && v.acceptedPolicy === true;

export const loadPending = () => storeRead<CheckoutSubmission>(PENDING_KEY, validSubmission);
export const savePending = (s: CheckoutSubmission | null) => storeWrite(PENDING_KEY, s);
export const loadConfirmation = () => storeRead<CheckoutAccess>(CONFIRM_KEY, validAccess);
export const saveConfirmation = (a: CheckoutAccess) => storeWrite(CONFIRM_KEY, { requestId: a.requestId, accessToken: a.accessToken });

/** Refresh catalog / POS / inventory / admin orders after an order event. */
export function useInvalidateCommerce() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({
    predicate: (q) => {
      const k = String(q.queryKey[0] ?? "");
      return k.startsWith("/api/products") || k === "/api/store" || k.includes("/pos") || k.startsWith("/api/admin") || k.startsWith("/api/inventory") || k.startsWith("/api/checkout");
    },
  });
}

/* ---------- Algerian phone ---------- */
export function normalizePhone(s: string) { return s.replace(/[\s.\-()]/g, ""); }
export function validDzPhone(s: string) { return /^(?:\+213|00213|0)[2-7]\d{8}$/.test(normalizePhone(s)); }

const ALG = (lang: string) => new Intl.DateTimeFormat(lang === "ar" ? "ar-DZ" : "fr-FR", { timeZone: "Africa/Algiers", dateStyle: "full", timeStyle: "short" });
export const fmtAlgiers = (iso: string, lang: string) => ALG(lang).format(new Date(iso));

/* ---------- Shop strings (FR / AR) ---------- */

const S = {
  fr: {
    cart: "Panier", cartEyebrow: "Votre sélection", cartEmpty: "Votre panier est vide.", cartEmptyText: "Choisissez une taille et une couleur sur une pièce disponible pour l'ajouter ici.",
    clear: "Vider le panier", remove: "Retirer", qty: "Quantité", unitHint: "Prix indicatif", subtotalHint: "Sous-total indicatif",
    cartNote: "Les prix, la disponibilité et les frais sont vérifiés par la boutique au moment du calcul de la commande. Rien n'est réservé avant l'envoi.",
    toCheckout: "Passer la commande", continue: "Continuer mes achats",
    offTitle: "La commande en ligne n'est pas ouverte pour le moment.", offText: "Votre panier reste enregistré sur cet appareil. Appelez la boutique pour réserver une pièce.",
    addToCart: "Ajouter au panier", added: "Ajouté au panier", chooseVariant: "Choisissez une taille et une couleur", inStock: "disponible(s)", outStock: "Épuisé", unavailableCombo: "Cette combinaison n'existe pas",
    from: "À partir de", previewOnly: "Pièce en aperçu : renseignez-vous par téléphone.", cartFull: "Le panier est limité à 20 articles différents.", viewCart: "Voir le panier",
    checkout: "Commande", checkoutEyebrow: "Finaliser", mode: "Mode de réception", delivery: "Livraison", pickup: "Retrait en boutique", zone: "Wilaya de livraison", chooseZone: "Choisir une wilaya", home: "Livraison à domicile", desk: "Retrait au bureau du transporteur", deskNote: "Vous retirez le colis au bureau du transporteur dans votre commune ; la boutique vous communiquera le bureau.", days: "jours",
    contactInfo: "Vos coordonnées", name: "Nom et prénom", phone: "Téléphone (Algérie)", commune: "Commune", address: "Adresse de livraison", notes: "Remarques (facultatif)",
    pickupAt: "Retrait à l'adresse", policy: "Conditions de la boutique", accept: "J'ai lu et j'accepte les conditions ci-dessus.",
    quote: "Calculer le total", requote: "Recalculer", quoteStale: "Le panier ou le mode a changé : recalculez le total avant d'envoyer.",
    review: "Récapitulatif vérifié", subtotal: "Sous-total", fee: "Frais", total: "Total à payer à la réception", hold: "Les pièces seront réservées pendant", minutes: "minutes après l'envoi.",
    place: "Envoyer la commande", placing: "Envoi en cours...", payNote: "Paiement en espèces à la réception ou au retrait. Aucun paiement en ligne.",
    errName: "Nom requis (3 caractères minimum).", errPhone: "Numéro algérien invalide.", errAddr: "Commune et adresse requises.", errZone: "Choisissez une wilaya et un mode de livraison.", errAccept: "Veuillez accepter les conditions.", errQuote: "Calculez d'abord le total.",
    pendingTitle: "Une commande est en cours d'envoi depuis cet onglet.", pendingText: "Nous ne savons pas encore si la boutique l'a reçue. Renvoyez exactement la même demande ou vérifiez : aucune commande en double ne sera créée.",
    retry: "Renvoyer la même demande", verify: "Vérifier si elle est reçue", abandon: "Annuler cette demande", abandonConfirm: "Annuler cette demande ? Si la boutique l'a déjà reçue, elle vous sera affichée.",
    notFoundYet: "La boutique n'a pas encore trouvé cette demande. Vous pouvez la renvoyer ou l'annuler.", unlocked: "Demande annulée. Vous pouvez modifier votre commande.",
    storageCorrupt: "Une commande enregistrée dans cet onglet est illisible. Par sécurité, aucun nouvel envoi n'est possible ici. Appelez la boutique.",
    storageWrite: "Impossible d'enregistrer la demande dans cet onglet (stockage bloqué ou plein). Rien n'a été envoyé.",
    confTitle: "Commande reçue", confEyebrow: "Merci", confPending: "Reçue, en attente de confirmation par la boutique.", confCancelled: "Commande annulée.", confExpired: "Commande expirée.",
    reference: "Référence", unpaid: "Non payée : paiement à la réception", expires: "Réservation valable jusqu'au", maskedPhone: "Téléphone", fulfil: "Réception",
    noConf: "Aucune commande à afficher dans cet onglet.", noConfText: "Le détail d'une commande n'est visible que dans l'onglet où elle a été passée. Pour toute question, appelez la boutique.",
    loadingOrder: "Chargement de la commande...", storageCleanup: "Commande reçue, mais cet onglet n'a pas pu mettre à jour son stockage local. Ne renvoyez pas la commande : au rechargement, utilisez « Vérifier si elle est reçue ».", confCorrupt: "Les informations de commande enregistrées dans cet onglet sont illisibles. Elles n'ont pas été effacées. Appelez la boutique pour connaître l'état de votre commande.", backShop: "Retour à la boutique", callStore: "Appeler la boutique",
    orderOnline: "Commander en ligne", phaseOn: "Vous pouvez commander en ligne : choisissez la taille et la couleur, puis réglez en espèces à la réception ou au retrait en boutique.",
  },
  ar: {
    cart: "السلة", cartEyebrow: "اختياراتك", cartEmpty: "سلتك فارغة.", cartEmptyText: "اختاري المقاس واللون لقطعة متوفرة لإضافتها هنا.",
    clear: "إفراغ السلة", remove: "إزالة", qty: "الكمية", unitHint: "سعر تقريبي", subtotalHint: "المجموع التقريبي",
    cartNote: "يتحقق المتجر من الأسعار والتوفر والرسوم عند حساب الطلب. لا يُحجز أي شيء قبل الإرسال.",
    toCheckout: "إتمام الطلب", continue: "متابعة التسوق",
    offTitle: "الطلب عبر الإنترنت غير متاح حالياً.", offText: "سلتك محفوظة على هذا الجهاز. اتصلي بالمتجر لحجز قطعة.",
    addToCart: "أضيفي إلى السلة", added: "أضيفت إلى السلة", chooseVariant: "اختاري المقاس واللون", inStock: "متوفرة", outStock: "نفدت", unavailableCombo: "هذا الاختيار غير موجود",
    from: "ابتداءً من", previewOnly: "قطعة للمعاينة: استفسري بالهاتف.", cartFull: "السلة محدودة بـ 20 قطعة مختلفة.", viewCart: "عرض السلة",
    checkout: "الطلب", checkoutEyebrow: "إتمام", mode: "طريقة الاستلام", delivery: "توصيل", pickup: "استلام من المتجر", zone: "ولاية التوصيل", chooseZone: "اختاري ولاية", home: "توصيل إلى المنزل", desk: "استلام من مكتب شركة التوصيل", deskNote: "تستلمين الطرد من مكتب شركة التوصيل في بلديتك؛ سيبلغك المتجر بالمكتب.", days: "أيام",
    contactInfo: "معلوماتك", name: "الاسم واللقب", phone: "الهاتف (الجزائر)", commune: "البلدية", address: "عنوان التوصيل", notes: "ملاحظات (اختياري)",
    pickupAt: "الاستلام من العنوان", policy: "شروط المتجر", accept: "قرأت الشروط أعلاه وأوافق عليها.",
    quote: "حساب المجموع", requote: "إعادة الحساب", quoteStale: "تغيرت السلة أو طريقة الاستلام: أعيدي حساب المجموع قبل الإرسال.",
    review: "ملخص مُتحقق منه", subtotal: "المجموع الفرعي", fee: "الرسوم", total: "المبلغ المستحق عند الاستلام", hold: "تُحجز القطع لمدة", minutes: "دقيقة بعد الإرسال.",
    place: "إرسال الطلب", placing: "جارٍ الإرسال...", payNote: "الدفع نقداً عند الاستلام أو في المتجر. لا يوجد دفع عبر الإنترنت.",
    errName: "الاسم مطلوب (3 أحرف على الأقل).", errPhone: "رقم جزائري غير صالح.", errAddr: "البلدية والعنوان مطلوبان.", errZone: "اختاري ولاية وطريقة التوصيل.", errAccept: "يرجى الموافقة على الشروط.", errQuote: "احسبي المجموع أولاً.",
    pendingTitle: "يوجد طلب قيد الإرسال من هذه النافذة.", pendingText: "لا نعرف بعد إن كان المتجر قد استلمه. أعيدي إرسال الطلب نفسه أو تحققي: لن يُنشأ طلب مكرر.",
    retry: "إعادة إرسال الطلب نفسه", verify: "التحقق من الاستلام", abandon: "إلغاء هذا الطلب", abandonConfirm: "إلغاء هذا الطلب؟ إن كان المتجر قد استلمه فسيظهر لك.",
    notFoundYet: "لم يجد المتجر هذا الطلب بعد. يمكنك إعادة إرساله أو إلغاؤه.", unlocked: "أُلغي الطلب. يمكنك تعديل طلبك.",
    storageCorrupt: "طلب محفوظ في هذه النافذة غير مقروء. للأمان لا يمكن إرسال طلب جديد هنا. اتصلي بالمتجر.",
    storageWrite: "تعذر حفظ الطلب في هذه النافذة (التخزين محظور أو ممتلئ). لم يُرسل شيء.",
    confTitle: "تم استلام الطلب", confEyebrow: "شكراً", confPending: "تم الاستلام، في انتظار تأكيد المتجر.", confCancelled: "أُلغي الطلب.", confExpired: "انتهت صلاحية الطلب.",
    reference: "المرجع", unpaid: "غير مدفوع: الدفع عند الاستلام", expires: "الحجز صالح حتى", maskedPhone: "الهاتف", fulfil: "الاستلام",
    noConf: "لا يوجد طلب لعرضه في هذه النافذة.", noConfText: "تفاصيل الطلب تظهر فقط في النافذة التي أُرسل منها. لأي سؤال اتصلي بالمتجر.",
    loadingOrder: "جارٍ تحميل الطلب...", storageCleanup: "تم استلام الطلب، لكن تعذر على هذه النافذة تحديث التخزين المحلي. لا تعيدي إرسال الطلب: عند إعادة التحميل استخدمي «التحقق من الاستلام».", confCorrupt: "معلومات الطلب المحفوظة في هذه النافذة غير مقروءة ولم تُحذف. اتصلي بالمتجر لمعرفة حالة طلبك.", backShop: "العودة إلى المتجر", callStore: "اتصلي بالمتجر",
    orderOnline: "اطلبي عبر الإنترنت", phaseOn: "يمكنك الطلب عبر الإنترنت: اختاري المقاس واللون، ثم ادفعي نقداً عند التوصيل أو الاستلام من المتجر.",
  },
} as const;
export type SKey = keyof typeof S.fr;
export function useShopT() {
  const { lang } = useI18n();
  return (k: SKey) => S[lang][k];
}

/* ---------- Localized customer error ---------- */
const AR_ERR = {
  400: "تعذر قبول الطلب: تحققي من الحقول، خاصة رقم الهاتف والعنوان، ثم أعيدي المحاولة.",
  404: "لم يُعثر على الطلب بعد. لا ترسلي طلباً جديداً: تحققي مرة أخرى بعد قليل.",
  409: "تغيّر التوفر أو السعر أو شروط المتجر. تحققي من الطلب أو أعيدي المحاولة بالمرجع نفسه.",
  429: "طلبات كثيرة في وقت قصير. انتظري قليلاً ثم أعيدي المحاولة؛ يبقى مرجع طلبك محفوظاً.",
  uncertain: "تعذر الاتصال بالمتجر أو حدث خطأ في الخادم. النتيجة غير مؤكدة: تحققي من الاستلام قبل إعادة المحاولة.",
  other: "تعذر إتمام العملية. أعيدي المحاولة أو اتصلي بالمتجر.",
} as const;
export function shopError(e: unknown, lang: string): string {
  if (lang !== "ar") return errMsg(e);
  const d = (e as { data?: unknown } | null)?.data;
  if (isObj(d) && typeof d.errorAr === "string" && d.errorAr.trim()) return d.errorAr;
  const st = (e as { status?: number } | null)?.status;
  if (typeof st !== "number" || st >= 500) return AR_ERR.uncertain;
  if (st === 400 || st === 422) return AR_ERR[400];
  if (st === 404) return AR_ERR[404];
  if (st === 409) return AR_ERR[409];
  if (st === 429) return AR_ERR[429];
  return AR_ERR.other;
}
