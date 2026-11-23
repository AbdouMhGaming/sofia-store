import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { AlertTriangle, Check, Loader2, MapPin, RefreshCw, Search, ShieldCheck, Truck, Store as StoreIcon } from "lucide-react";
import {
  useQuoteCheckout, usePlaceCheckoutOrder, useRecoverCheckoutOrder, useCancelCheckoutRequest,
  type CheckoutAccess, type CheckoutOrder, type CheckoutQuote, type CheckoutSubmission,
} from "@workspace/api-client-react";
import { useI18n } from "@/lib/i18n";
import { useSessionCsrf } from "@/lib/auth";
import { asset, formatDA } from "@/lib/util";
import { statusOf } from "@/lib/pos";
import {
  useCart, useCommerce, useShopT, useInvalidateCommerce, loadPending, savePending, loadConfirmation, saveConfirmation,
  newUuid, newAccessToken, normalizePhone, validDzPhone, fmtAlgiers, shopError, type SKey,
} from "@/lib/shop";
import { SiteLayout, PageTitle, CallButton } from "@/components/site";

const input = "w-full px-4 py-3 rounded-sm bg-card border border-border text-sm outline-none focus:border-primary transition-colors disabled:opacity-60";
const darkBtn = "inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-full bg-[#282326] text-[#f6efe9] text-sm hover:bg-primary transition-colors disabled:opacity-40 disabled:pointer-events-none";
const ghostBtn = "inline-flex items-center justify-center gap-2 px-5 py-3 rounded-full border border-border text-sm hover:border-primary hover:text-primary transition-colors disabled:opacity-40";

type Mode = "DELIVERY" | "PICKUP";
type DMode = "HOME" | "DESK";

export function CheckoutPage() {
  const { pick, lang } = useI18n();
  const s = useShopT();
  const [, nav] = useLocation();
  const cart = useCart();
  const { cfg, enabled } = useCommerce();
  const { request, session, token } = useSessionCsrf();
  const invalidate = useInvalidateCommerce();
  const quoteM = useQuoteCheckout({ request });
  const placeM = usePlaceCheckoutOrder({ request });
  const recoverM = useRecoverCheckoutOrder({ request });
  const cancelM = useCancelCheckoutRequest({ request });

  const [loaded] = useState(loadPending);
  const blocked = !loaded.ok;
  const [pending, setPending] = useState<CheckoutSubmission | null>(loaded.ok ? loaded.value : null);
  const init = pending;
  const [mode, setMode] = useState<Mode | "">(init?.fulfillment ?? "");
  const [zone, setZone] = useState(init?.zoneCode ?? "");
  const [dmode, setDmode] = useState<DMode | "">(init?.deliveryMode ?? "");
  const [name, setName] = useState(init?.customerName ?? "");
  const [phone, setPhone] = useState(init?.customerPhone ?? "");
  const [commune, setCommune] = useState(init?.commune ?? "");
  const [address, setAddress] = useState(init?.address ?? "");
  const [notes, setNotes] = useState(init?.notes ?? "");
  const [accept, setAccept] = useState(false);
  const [quote, setQuote] = useState<{ q: CheckoutQuote; key: string } | null>(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [savedOrder, setSavedOrder] = useState<CheckoutOrder | null>(null);
  const [captureWarn, setCaptureWarn] = useState(false);

  const c = cfg.data;
  const zones = useMemo(() => (c?.zones ?? []).filter((z) => z.enabled && (z.homeFeeMinor !== null || z.deskFeeMinor !== null)), [c]);
  const zoneObj = zones.find((z) => z.code === zone);
  useEffect(() => {
    if (!zoneObj) return;
    if (dmode === "HOME" && zoneObj.homeFeeMinor === null) setDmode("");
    if (dmode === "DESK" && zoneObj.deskFeeMinor === null) setDmode("");
  }, [zoneObj, dmode]);
  useEffect(() => {
    if (!c || mode) return;
    if (c.deliveryEnabled && !c.pickupEnabled) setMode("DELIVERY");
    else if (c.pickupEnabled && !c.deliveryEnabled) setMode("PICKUP");
  }, [c, mode]);

  const items = useMemo(() => cart.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })), [cart.lines]);
  const isDel = mode === "DELIVERY";
  const basketKey = JSON.stringify({ items, mode, zone: isDel ? zone : null, dmode: isDel ? dmode : null });
  const quoteValid = !!quote && quote.key === basketKey;
  const reviewed = quoteValid ? quote.q : c;
  const locked = !!pending || blocked;
  const busy = placeM.isPending || recoverM.isPending || cancelM.isPending || !token || session.isFetching || session.isError;

  const finish = (order: CheckoutOrder, access: CheckoutAccess) => {
    setSavedOrder(order);
    invalidate();
    cart.clear();
    if (!saveConfirmation(access)) { setCaptureWarn(true); return; } // keep pending so this tab can still recover
    if (!savePending(null)) { setCaptureWarn(true); return; } // stays locked on reload; recover will show the same order
    setPending(null);
    setName(""); setPhone(""); setCommune(""); setAddress(""); setNotes(""); setAccept(false); setQuote(null);
    nav("/commande/confirmation");
  };

  const send = (sub: CheckoutSubmission) => {
    setError(""); setInfo("");
    placeM.mutate({ data: sub }, {
      onSuccess: (order) => finish(order, sub),
      onError: (e) => setError(shopError(e, lang)), // never unlocks: pending stays until recovered or explicitly cancelled
    });
  };

  const runQuote = () => {
    setError("");
    if (!mode) return;
    if (isDel && (!zone || !dmode)) { setError(s("errZone")); return; }
    const key = basketKey;
    quoteM.mutate({ data: { items, fulfillment: mode, zoneCode: isDel ? zone : null, deliveryMode: isDel ? (dmode as DMode) : null } }, {
      onSuccess: (q) => { setQuote({ q, key }); setAccept(false); },
      onError: (e) => { setQuote(null); setError(shopError(e, lang)); },
    });
  };

  const submit = () => {
    setError(""); setInfo("");
    if (blocked) { setError(s("storageCorrupt")); return; }
    if (pending) return;
    if (!quote || !quoteValid) { setError(s("errQuote")); return; }
    if (name.trim().length < 3) { setError(s("errName")); return; }
    if (!validDzPhone(phone)) { setError(s("errPhone")); return; }
    if (isDel && (!commune.trim() || (dmode === "HOME" && !address.trim()))) { setError(s("errAddr")); return; }
    if (!accept) { setError(s("errAccept")); return; }
    let requestId: string, accessToken: string;
    try { requestId = newUuid(); accessToken = newAccessToken(); } catch { setError(s("storageWrite")); return; }
    const sub: CheckoutSubmission = {
      requestId, accessToken, expectedQuoteHash: quote.q.quoteHash,
      items, fulfillment: mode as Mode, zoneCode: isDel ? zone : null, deliveryMode: isDel ? (dmode as DMode) : null,
      customerName: name.trim(), customerPhone: normalizePhone(phone),
      commune: isDel ? commune.trim() : "", address: isDel && dmode === "HOME" ? address.trim() : "",
      notes: notes.trim(), acceptedPolicy: true,
    };
    if (!savePending(sub)) { setError(s("storageWrite")); return; }
    setPending(sub);
    send(sub);
  };

  const verify = () => {
    if (!pending) return;
    setError(""); setInfo("");
    const access = { requestId: pending.requestId, accessToken: pending.accessToken };
    recoverM.mutate({ data: access }, {
      onSuccess: (order) => finish(order, access),
      onError: (e) => (statusOf(e) === 404 ? setInfo(s("notFoundYet")) : setError(shopError(e, lang))),
    });
  };

  const abandon = () => {
    if (!pending || !window.confirm(s("abandonConfirm"))) return;
    setError(""); setInfo("");
    const access = { requestId: pending.requestId, accessToken: pending.accessToken };
    cancelM.mutate({ data: access }, {
      onSuccess: (r) => {
        if (r.cancelled) {
          if (!savePending(null)) { setError(s("storageWrite")); return; }
          setPending(null); setQuote(null); setAccept(false); setInfo(s("unlocked"));
        } else if (r.order) finish(r.order, access);
      },
      onError: (e) => setError(shopError(e, lang)),
    });
  };

  if (savedOrder && captureWarn) {
    return (
      <SiteLayout>
        <PageTitle eyebrow={s("confEyebrow")} title={s("confTitle")} />
        <div className="max-w-4xl mx-auto px-5 md:px-10">
          <Banner tone="info" testId="status-storage-cleanup">{s("storageCleanup")}</Banner>
          <OrderView order={savedOrder} />
        </div>
      </SiteLayout>
    );
  }

  return (
    <SiteLayout>
      <PageTitle eyebrow={s("checkoutEyebrow")} title={s("checkout")} />
      <div className="max-w-7xl mx-auto px-5 md:px-10">
        {blocked && <Banner tone="danger" testId="status-storage-corrupt">{s("storageCorrupt")}</Banner>}
        {pending && (
          <div className="mb-8 border border-[#d98c62]/40 bg-[#fbf1ea] rounded-sm p-6 md:p-8" data-testid="panel-pending">
            <div className="flex gap-3 items-start">
              <AlertTriangle className="w-5 h-5 text-[#a65429] shrink-0 mt-1" />
              <div className="flex-1">
                <p className="font-serif text-2xl">{s("pendingTitle")}</p>
                <p className="text-sm text-muted-foreground mt-2 max-w-2xl">{s("pendingText")}</p>
                <div className="flex flex-wrap gap-3 mt-5">
                  <button className={darkBtn} disabled={busy} onClick={() => send(pending)} data-testid="button-retry-order">
                    {placeM.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}{s("retry")}
                  </button>
                  <button className={ghostBtn} disabled={busy} onClick={verify} data-testid="button-verify-order">
                    {recoverM.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}{s("verify")}
                  </button>
                  <button className={`${ghostBtn} hover:!border-destructive hover:!text-destructive`} disabled={busy} onClick={abandon} data-testid="button-abandon-order">{s("abandon")}</button>
                </div>
              </div>
            </div>
          </div>
        )}
        {error && <Banner tone="danger" testId="text-checkout-error">{error}</Banner>}
        {session.isError && <Banner tone="danger" testId="text-security-error">
          {pick("Connexion de sécurité indisponible. Réessayez avant de continuer.", "اتصال الأمان غير متاح. أعيدي المحاولة قبل المتابعة.")}
          <button className="block mt-3 underline" type="button" disabled={session.isFetching} onClick={() => void session.refetch()}>{pick("Réessayer", "إعادة المحاولة")}</button>
        </Banner>}
        {info && <Banner tone="info" testId="text-checkout-info">{info}</Banner>}

        {cfg.isLoading || (cfg.isFetching && !enabled) ? <div className="h-96 bg-muted animate-pulse rounded-sm" /> : cfg.isError ? (
          <Banner tone="danger" testId="text-commerce-error">{pick("Impossible de vérifier les options de commande.", "تعذر التحقق من خيارات الطلب.")}
            <button className="block mt-3 underline" type="button" onClick={() => void cfg.refetch()}>{pick("Réessayer", "إعادة المحاولة")}</button>
          </Banner>
        ) : !enabled ? (
          <div className="py-16 text-center border border-dashed border-border rounded-sm" data-testid="status-commerce-off">
            <p className="font-serif text-3xl">{s("offTitle")}</p>
            <p className="text-sm text-muted-foreground mt-3">{s("offText")}</p>
            <CallButton label={s("callStore")} className="mt-6" />
          </div>
        ) : cart.lines.length === 0 && !pending ? (
          <div className="py-16 text-center border border-dashed border-border rounded-sm" data-testid="status-cart-empty">
            <p className="font-serif text-3xl">{s("cartEmpty")}</p>
            <Link href="/boutique" className="inline-block mt-6 text-sm text-primary link-underline">{s("continue")}</Link>
          </div>
        ) : (
          <div className="grid md:grid-cols-[1.4fr_1fr] gap-10 items-start">
            <fieldset disabled={locked || busy} className="space-y-10">
              <section>
                <Step n="01" title={s("mode")} />
                <div className="grid sm:grid-cols-2 gap-3 mt-5">
                  {c?.deliveryEnabled && (
                    <ModeCard on={mode === "DELIVERY"} onClick={() => setMode("DELIVERY")} icon={<Truck className="w-5 h-5" strokeWidth={1.4} />} label={s("delivery")} testId="button-mode-delivery" />
                  )}
                  {c?.pickupEnabled && (
                    <ModeCard on={mode === "PICKUP"} onClick={() => setMode("PICKUP")} icon={<StoreIcon className="w-5 h-5" strokeWidth={1.4} />} label={s("pickup")} testId="button-mode-pickup" />
                  )}
                </div>
                {mode === "DELIVERY" && (
                  <label className="block mt-5">
                    <span className="text-sm text-muted-foreground">{s("zone")}</span>
                    <select value={zone} onChange={(e) => setZone(e.target.value)} className={`${input} mt-1.5`} data-testid="select-zone">
                      <option value="">{s("chooseZone")}</option>
                      {zones.map((z) => <option key={z.code} value={z.code}>{z.code} · {pick(z.nameFr, z.nameAr)}</option>)}
                    </select>
                  </label>
                )}
                {mode === "DELIVERY" && zoneObj && (
                  <div className="grid sm:grid-cols-2 gap-3 mt-4">
                    {(["HOME", "DESK"] as const).map((m) => {
                      const fee = m === "HOME" ? zoneObj.homeFeeMinor : zoneObj.deskFeeMinor;
                      if (fee === null) return null;
                      const eta = etaText(m === "HOME" ? zoneObj.homeMinDays : zoneObj.deskMinDays, m === "HOME" ? zoneObj.homeMaxDays : zoneObj.deskMaxDays, s);
                      return (
                        <button key={m} type="button" onClick={() => setDmode(m)} data-testid={`button-dmode-${m.toLowerCase()}`}
                          className={`p-4 rounded-sm border text-start transition-all ${dmode === m ? "border-[#282326] bg-[#282326] text-[#f6efe9]" : "border-border hover:border-primary"}`}>
                          <span className="font-serif text-lg block">{m === "HOME" ? s("home") : s("desk")}</span>
                          <span className="text-xs opacity-80 block mt-1">{formatDA(fee)}{eta ? ` · ${eta}` : ""}</span>
                        </button>
                      );
                    })}
                    {dmode === "DESK" && <p className="sm:col-span-2 text-xs text-muted-foreground">{s("deskNote")}</p>}
                  </div>
                )}
                {mode === "PICKUP" && c && (
                  <p className="mt-5 flex gap-2 text-sm"><MapPin className="w-4 h-4 text-secondary shrink-0 mt-0.5" /><span><span className="text-muted-foreground">{s("pickupAt")} : </span>{pick(reviewed?.pickupAddressFr ?? c.pickupAddressFr, reviewed?.pickupAddressAr ?? c.pickupAddressAr)}</span></p>
                )}
              </section>

              <section>
                <Step n="02" title={s("contactInfo")} />
                <div className="grid sm:grid-cols-2 gap-4 mt-5">
                  <L label={s("name")}><input className={input} value={name} maxLength={150} onChange={(e) => setName(e.target.value)} autoComplete="name" data-testid="input-name" /></L>
                  <L label={s("phone")}><input className={input} value={phone} maxLength={25} dir="ltr" inputMode="tel" onChange={(e) => setPhone(e.target.value)} autoComplete="tel" placeholder="05 / 06 / 07 ..." data-testid="input-phone" /></L>
                  {mode === "DELIVERY" && <>
                    <L label={s("commune")}><input className={input} value={commune} maxLength={150} onChange={(e) => setCommune(e.target.value)} data-testid="input-commune" /></L>
                    {dmode === "HOME" && <L label={s("address")} wide><textarea className={`${input} min-h-20`} value={address} maxLength={500} onChange={(e) => setAddress(e.target.value)} data-testid="input-address" /></L>}
                  </>}
                  <L label={s("notes")} wide><textarea className={`${input} min-h-16`} value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} data-testid="input-notes" /></L>
                </div>
              </section>

              {reviewed && pick(reviewed.policyFr, reviewed.policyAr) && (
                <section>
                  <Step n="03" title={s("policy")} />
                  <p className="mt-5 text-sm text-muted-foreground whitespace-pre-line leading-relaxed bg-card border border-border rounded-sm p-5 max-h-60 overflow-auto" data-testid="text-policy">{pick(reviewed.policyFr, reviewed.policyAr)}</p>
                  <label className="mt-4 flex gap-3 items-start text-sm cursor-pointer">
                    <input type="checkbox" checked={accept} disabled={!quoteValid || quoteM.isPending} onChange={(e) => setAccept(e.target.checked)} className="mt-0.5 accent-[#a82d64] w-4 h-4 disabled:opacity-40" data-testid="checkbox-accept" />
                    {s("accept")}
                  </label>
                </section>
              )}
            </fieldset>

            <aside className="md:sticky md:top-28 bg-[#f7e6ec]/60 border border-primary/10 rounded-sm p-7 space-y-5" data-testid="panel-review">
              <p className="eyebrow">{s("review")}</p>
              {!pending && (
                <button className={`${ghostBtn} w-full`} disabled={!mode || quoteM.isPending || busy || blocked} onClick={runQuote} data-testid="button-quote">
                  {quoteM.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}{quote ? s("requote") : s("quote")}
                </button>
              )}
              {quote && !quoteValid && !pending && <p className="text-sm text-[#a65429]" data-testid="text-quote-stale">{s("quoteStale")}</p>}
              {quote && quoteValid && (
                <div className="space-y-4 rise">
                  <ul className="space-y-3">
                    {quote.q.items.map((l) => (
                      <li key={l.variantId} className="flex gap-3 text-sm">
                        <div className="w-12 aspect-[3/4] bg-muted rounded-sm overflow-hidden shrink-0">{l.image && <img src={asset(l.image)} alt="" className="w-full h-full object-cover" />}</div>
                        <div className="flex-1 min-w-0"><p className="truncate">{pick(l.productName, l.nameAr)}</p><p className="text-xs text-muted-foreground">{l.size} · {l.color} · x{l.quantity}</p></div>
                        <span className="tabular-nums">{formatDA(l.lineTotalMinor)}</span>
                      </li>
                    ))}
                  </ul>
                  <Totals sub={quote.q.subtotalMinor} fee={quote.q.feeMinor} total={quote.q.totalMinor} />
                  {quote.q.deliveryMode && <p className="text-xs" data-testid="text-quote-eta">{quote.q.deliveryMode === "HOME" ? s("home") : s("desk")}{etaText(quote.q.deliveryMinDays, quote.q.deliveryMaxDays, s) ? ` · ${etaText(quote.q.deliveryMinDays, quote.q.deliveryMaxDays, s)}` : ""}</p>}
                  <p className="text-xs text-muted-foreground">{s("hold")} {quote.q.reservationMinutes} {s("minutes")}</p>
                </div>
              )}
              <p className="text-xs text-muted-foreground flex gap-2"><ShieldCheck className="w-4 h-4 shrink-0" />{s("payNote")}</p>
              {!pending && (
                <button className={`${darkBtn} w-full`} disabled={!quoteValid || !accept || busy || blocked || quoteM.isPending} onClick={submit} data-testid="button-place-order">
                  {placeM.isPending ? <><Loader2 className="w-4 h-4 animate-spin" />{s("placing")}</> : <><Check className="w-4 h-4" />{s("place")}</>}
                </button>
              )}
            </aside>
          </div>
        )}
      </div>
    </SiteLayout>
  );
}

export function ConfirmationPage() {
  const { lang } = useI18n();
  const s = useShopT();
  const { request, session, token } = useSessionCsrf();
  const recoverM = useRecoverCheckoutOrder({ request });
  const [cap] = useState(loadConfirmation);
  const started = useRef(false);
  const access = cap.ok ? cap.value : null;
  const csrfReady = !!token && !session.isFetching && !session.isError;
  const run = () => {
    if (!csrfReady) { started.current = false; void session.refetch(); return; }
    if (access) recoverM.mutate({ data: { requestId: access.requestId, accessToken: access.accessToken } });
  };
  useEffect(() => {
    // POST recovery needs the CSRF token AND cookie from GET /auth/session first.
    if (started.current || !access || !csrfReady) return;
    started.current = true;
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access, csrfReady]);
  return (
    <SiteLayout>
      <PageTitle eyebrow={s("confEyebrow")} title={s("confTitle")} />
      <div className="max-w-4xl mx-auto px-5 md:px-10">
        {!cap.ok ? (
          <div className="py-16 text-center border border-destructive/30 bg-destructive/5 rounded-sm" data-testid="status-confirmation-corrupt">
            <p className="font-serif text-2xl">{s("confCorrupt")}</p>
            <div className="flex justify-center mt-6"><CallButton label={s("callStore")} /></div>
          </div>
        ) : !access ? (
          <div className="py-16 text-center border border-dashed border-border rounded-sm" data-testid="status-no-confirmation">
            <p className="font-serif text-3xl">{s("noConf")}</p>
            <p className="text-sm text-muted-foreground mt-3 max-w-md mx-auto">{s("noConfText")}</p>
            <div className="flex flex-wrap gap-3 justify-center mt-6">
              <Link href="/boutique" className={ghostBtn}>{s("backShop")}</Link>
              <CallButton label={s("callStore")} />
            </div>
          </div>
        ) : recoverM.data ? <OrderView order={recoverM.data} />
          : recoverM.isError || session.isError ? (
            <div className="border border-destructive/30 bg-destructive/5 rounded-sm p-8 text-center" data-testid="status-error">
              <p className="text-sm">{shopError(recoverM.error ?? session.error, lang)}</p>
              <button className={`${darkBtn} mt-5`} disabled={session.isFetching || recoverM.isPending} onClick={run} data-testid="button-retry">{s("verify")}</button>
            </div>
          ) : (
            <div className="space-y-4" data-testid="status-loading">
              <div className="h-24 bg-muted animate-pulse rounded-sm" /><div className="h-64 bg-muted animate-pulse rounded-sm" />
              <p className="sr-only">{s("loadingOrder")}</p>
            </div>
          )}
      </div>
    </SiteLayout>
  );
}

export function OrderView({ order }: { order: CheckoutOrder }) {
  const { pick, lang } = useI18n();
  const s = useShopT();
  const st = CUST_STATUS[order.status];
  const status = st ? pick(st[0], st[1]) : order.status;
  const closed = ["CANCELLED", "EXPIRED", "RETURNED"].includes(order.status);
  const refunded = order.refundedMinor;
  const pay = order.paymentStatus === "REFUNDED" ? pick("Remboursée", "تم الاسترداد")
    : order.paymentStatus === "PAID" ? pick("Payée : montant reçu par la boutique", "مدفوعة: استلم المتجر المبلغ")
    : order.paymentStatus === "COLLECTED_BY_COURIER" ? pick("Payée au transporteur", "مدفوعة لشركة التوصيل")
    : closed ? pick("Aucun montant dû", "لا يوجد مبلغ مستحق") : s("unpaid");
  return (
    <div className="space-y-8 rise" data-testid="panel-order">
      <div className="bg-[#282326] text-[#f6efe9] rounded-sm p-8 md:p-10 grid md:grid-cols-2 gap-6">
        <div>
          <p className="text-[11px] tracking-[0.25em] uppercase opacity-70">{s("reference")}</p>
          <p className="font-serif text-4xl md:text-5xl mt-2" dir="ltr" data-testid="text-order-reference">{order.reference}</p>
          <p className="mt-4 text-[#f3d6e2]" data-testid="text-order-status">{status}</p>
        </div>
        <div className="text-sm space-y-2 md:text-end">
          <p className="inline-block px-3 py-1 rounded-full border border-white/25" data-testid="text-payment-status">{pay}</p>
          {refunded > 0 && <p className="opacity-90" data-testid="text-refunded">{pick("Montant remboursé", "المبلغ المسترد")} : {formatDA(refunded)}</p>}
          {(order.carrierName || order.trackingNumber) && <p className="opacity-80" data-testid="text-tracking">{pick("Transporteur", "شركة التوصيل")} : {order.carrierName}{order.trackingNumber && <> · <span dir="ltr" className="font-mono">{order.trackingNumber}</span></>}</p>}
          {order.status === "PENDING" && <p className="opacity-80" data-testid="text-expires">{s("expires")} {fmtAlgiers(order.expiresAt, lang)}</p>}
          <p className="opacity-80">{s("maskedPhone")} : <span dir="ltr">{order.maskedPhone}</span></p>
        </div>
      </div>
      <div className="grid md:grid-cols-[1.4fr_1fr] gap-8">
        <ul className="divide-y divide-border border-y border-border">
          {order.items.map((l) => (
            <li key={l.variantId} className="py-4 flex gap-4 text-sm">
              <div className="w-14 aspect-[3/4] bg-muted rounded-sm overflow-hidden shrink-0">{l.image && <img src={asset(l.image)} alt="" className="w-full h-full object-cover" />}</div>
              <div className="flex-1"><p className="font-serif text-lg">{pick(l.productName, l.nameAr)}</p><p className="text-muted-foreground">{l.size} · {l.color} · x{l.quantity}</p></div>
              <span className="tabular-nums">{formatDA(l.lineTotalMinor)}</span>
            </li>
          ))}
        </ul>
        <div className="space-y-5">
          <Totals sub={order.subtotalMinor} fee={order.feeMinor} total={order.totalMinor} historical={closed || order.paymentStatus !== "UNPAID"} />
          <div className="text-sm">
            <p className="eyebrow">{s("fulfil")}</p>
            <p className="mt-2">{order.fulfillment === "DELIVERY" ? `${s("delivery")} · ${pick(order.zoneNameFr, order.zoneNameAr)} · ${order.deliveryMode === "DESK" ? s("desk") : s("home")}` : s("pickup")}</p>
            {order.fulfillment === "DELIVERY" && etaText(order.deliveryMinDays, order.deliveryMaxDays, s) && <p className="text-muted-foreground mt-1" data-testid="text-order-eta">{etaText(order.deliveryMinDays, order.deliveryMaxDays, s)}</p>}
            {order.fulfillment === "PICKUP" && <p className="text-muted-foreground mt-1">{pick(order.pickupAddressFr, order.pickupAddressAr)}</p>}
          </div>
          {pick(order.policyFr, order.policyAr) && (
            <div className="text-sm"><p className="eyebrow">{s("policy")}</p><p className="mt-2 text-muted-foreground whitespace-pre-line">{pick(order.policyFr, order.policyAr)}</p></div>
          )}
          <Link href="/boutique" className="inline-block text-sm text-primary link-underline">{s("backShop")}</Link>
        </div>
      </div>
    </div>
  );
}

const CUST_STATUS: Record<string, [string, string]> = {
  PENDING: ["Reçue, en attente de confirmation par la boutique.", "تم الاستلام، في انتظار تأكيد المتجر."],
  CONFIRMED: ["Confirmée par la boutique.", "أكّد المتجر الطلب."],
  PREPARING: ["En cours de préparation.", "قيد التحضير."],
  READY: ["Prête.", "جاهزة."],
  DISPATCHED: ["Remise au transporteur.", "سُلّمت لشركة التوصيل."],
  DELIVERED: ["Livrée.", "تم التوصيل."],
  COMPLETED: ["Terminée. Merci.", "مكتملة. شكراً."],
  RETURNING: ["Retour en cours vers la boutique.", "الإرجاع جارٍ نحو المتجر."],
  RETURNED: ["Retournée à la boutique.", "أُعيدت إلى المتجر."],
  CANCELLED: ["Commande annulée.", "أُلغي الطلب."],
  EXPIRED: ["Commande expirée.", "انتهت صلاحية الطلب."],
};

function etaText(min: number | null, max: number | null, s: (k: SKey) => string) {
  if (min === null || max === null) return "";
  return min === max ? `${min} ${s("days")}` : `${min}–${max} ${s("days")}`;
}

function Totals({ sub, fee, total, historical = false }: { sub: number; fee: number; total: number; historical?: boolean }) {
  const s = useShopT();
  const { pick } = useI18n();
  return (
    <dl className="text-sm space-y-2 border-t border-border pt-4">
      <div className="flex justify-between"><dt className="text-muted-foreground">{s("subtotal")}</dt><dd className="tabular-nums" data-testid="text-subtotal">{formatDA(sub)}</dd></div>
      <div className="flex justify-between"><dt className="text-muted-foreground">{s("fee")}</dt><dd className="tabular-nums" data-testid="text-fee">{formatDA(fee)}</dd></div>
      <div className="flex justify-between items-baseline pt-2 border-t border-border"><dt>{historical ? pick("Total initial de la commande", "إجمالي الطلب الأصلي") : s("total")}</dt><dd className="font-serif text-3xl tabular-nums" data-testid="text-total">{formatDA(total)}</dd></div>
    </dl>
  );
}

function Banner({ tone, testId, children }: { tone: "danger" | "info"; testId: string; children: ReactNode }) {
  return <div role={tone === "danger" ? "alert" : "status"} className={`mb-6 text-sm rounded-sm px-4 py-3 border ${tone === "danger" ? "border-destructive/30 bg-destructive/5 text-destructive" : "border-secondary/30 bg-[#fbf1ea] text-[#a65429]"}`} data-testid={testId}>{children}</div>;
}
function Step({ n, title }: { n: string; title: string }) {
  return <div className="flex items-baseline gap-4 border-b border-border pb-3"><span className="font-serif italic text-3xl text-secondary/80">{n}</span><h2 className="font-serif text-3xl">{title}</h2></div>;
}
function L({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return <label className={`block ${wide ? "sm:col-span-2" : ""}`}><span className="text-sm text-muted-foreground">{label}</span><div className="mt-1.5">{children}</div></label>;
}
function ModeCard({ on, onClick, icon, label, testId }: { on: boolean; onClick: () => void; icon: React.ReactNode; label: string; testId: string }) {
  return (
    <button type="button" onClick={onClick} data-testid={testId}
      className={`flex items-center gap-3 p-5 rounded-sm border text-start transition-all ${on ? "border-[#282326] bg-[#282326] text-[#f6efe9]" : "border-border hover:border-primary"}`}>
      {icon}<span className="font-serif text-xl">{label}</span>
    </button>
  );
}
