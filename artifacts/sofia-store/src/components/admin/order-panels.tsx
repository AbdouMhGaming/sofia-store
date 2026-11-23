import { useState } from "react";
import { Link } from "wouter";
import { Banknote } from "lucide-react";
import type { AdminCheckoutOrder, WebOrderAction, WebOrderPaymentInput, WebOrderOperation, RegisterSession } from "@workspace/api-client-react";
import { formatDA } from "@/lib/util";
import { parseMoney } from "@/lib/pos";
import { inputCls, btnDark } from "@/components/admin/shell-primitives";
import { ACTION, Row, Money } from "@/components/admin/order-ui";

export type Submit = (make: (requestId: string) => { kind: "ACTION"; body: WebOrderAction } | { kind: "PAYMENT"; body: WebOrderPaymentInput }) => boolean;

export function ActionPanel({ o, locked, submit }: { o: AdminCheckoutOrder; locked: boolean; submit: Submit }) {
  const actions = o.allowedActions;
  const [sel, setSel] = useState<WebOrderOperation | "">("");
  const [reason, setReason] = useState("");
  const [collector, setCollector] = useState<"STAFF" | "COURIER" | "">(o.fulfillment === "PICKUP" ? "STAFF" : "");
  const [carrier, setCarrier] = useState(o.carrierName);
  const [tracking, setTracking] = useState(o.trackingNumber);
  const [restock, setRestock] = useState<number[]>([]);
  const [attest, setAttest] = useState(false);
  const [e, setE] = useState("");
  if (actions.length === 0) return (
    <section className="rounded-md border border-dashed border-border p-5 text-sm text-muted-foreground" data-testid="status-no-actions">Aucune opération possible à ce stade.</section>
  );
  const needsAttest = sel === "COURIER_COLLECT" || sel === "RETURN_RECEIVE" || sel === "CANCEL" || sel === "DISPATCH";
  const go = () => {
    setE("");
    const r = reason.trim();
    if (!sel) return;
    if (r.length < 3 || r.length > 500) { setE("Motif requis (3 à 500 caractères)."); return; }
    if (sel === "CONFIRM" && !collector) { setE("Choisissez qui encaisse la cliente."); return; }
    if (sel === "CONFIRM" && o.fulfillment === "PICKUP" && collector !== "STAFF") { setE("Un retrait est toujours encaissé par le personnel."); return; }
    if (sel === "DISPATCH" && o.collector === "COURIER" && (!carrier.trim() || !tracking.trim())) { setE("Transporteur et numéro de suivi obligatoires quand le coursier encaisse."); return; }
    if (needsAttest && !attest) { setE("Cochez l'attestation."); return; }
    const action = sel;
    const ok = submit((requestId) => ({ kind: "ACTION", body: {
      requestId, expectedStatus: o.status, action, reason: r,
      collector: sel === "CONFIRM" ? (collector as "STAFF" | "COURIER") : null,
      carrierName: sel === "DISPATCH" ? carrier.trim().slice(0, 150) : "", trackingNumber: sel === "DISPATCH" ? tracking.trim().slice(0, 150) : "",
      restockVariantIds: sel === "RETURN_RECEIVE" ? restock : null,
    } }));
    if (ok) { setSel(""); setReason(""); setAttest(false); setRestock([]); }
  };
  const attestText = sel === "COURIER_COLLECT" ? `J'atteste que le transporteur a encaissé ${formatDA(o.totalMinor)} auprès de la cliente. Cet argent n'est pas encore en boutique.`
    : sel === "RETURN_RECEIVE" ? "J'atteste que la commande entière est physiquement revenue en boutique. Seules les pièces cochées sont remises en stock ; les autres sont considérées abîmées."
    : sel === "CANCEL" ? "J'annule cette commande avant expédition. Le stock réservé sera libéré." : "J'atteste que les pièces quittent physiquement la boutique.";
  return (
    <section className="bg-card border border-border rounded-md p-5 space-y-4" data-testid="panel-actions">
      <h2 className="font-serif text-2xl">Faire avancer</h2>
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <button key={a} type="button" disabled={locked} onClick={() => { setSel(sel === a ? "" : a); setAttest(false); setE(""); }} data-testid={`button-action-${a.toLowerCase()}`}
            className={`px-3.5 py-2 rounded-full border text-sm transition-colors disabled:opacity-40 ${sel === a ? (ACTION[a]?.danger ? "bg-destructive text-destructive-foreground border-destructive" : "bg-[#282326] text-[#f6efe9] border-[#282326]") : ACTION[a]?.danger ? "border-destructive/40 text-destructive hover:bg-destructive/5" : "border-border hover:border-primary hover:text-primary"}`}>
            {ACTION[a]?.label ?? a}
          </button>
        ))}
      </div>
      {sel && (
        <fieldset disabled={locked} className="space-y-3 rise">
          <p className="text-xs text-muted-foreground">{ACTION[sel]?.hint}</p>
          {sel === "CONFIRM" && (
            <div className="grid grid-cols-2 gap-2">
              {(["STAFF", "COURIER"] as const).map((c) => (
                <button key={c} type="button" disabled={o.fulfillment === "PICKUP" && c === "COURIER"} onClick={() => setCollector(c)} data-testid={`button-collector-${c.toLowerCase()}`}
                  className={`p-3 rounded-md border text-start text-sm disabled:opacity-40 ${collector === c ? "border-[#282326] bg-[#282326] text-[#f6efe9]" : "border-border"}`}>
                  <span className="font-medium block">{c === "STAFF" ? "Personnel" : "Coursier"}</span>
                  <span className="text-xs opacity-75">{c === "STAFF" ? "La cliente paie la boutique" : "Le transporteur encaisse puis reverse"}</span>
                </button>
              ))}
            </div>
          )}
          {sel === "DISPATCH" && (
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-muted-foreground">Transporteur<input className={`${inputCls} mt-1`} maxLength={150} value={carrier} onChange={(ev) => setCarrier(ev.target.value)} data-testid="input-carrier" /></label>
              <label className="text-xs text-muted-foreground">N° de suivi<input className={`${inputCls} mt-1 font-mono`} maxLength={150} value={tracking} onChange={(ev) => setTracking(ev.target.value)} data-testid="input-tracking" /></label>
              <p className="col-span-2 text-[11px] text-muted-foreground">{o.collector === "COURIER" ? "Obligatoires : le transporteur encaisse." : "Facultatifs pour une livraison encaissée par le personnel."}</p>
            </div>
          )}
          {sel === "RETURN_RECEIVE" && (
            <div className="border border-border rounded-md divide-y divide-border">
              <p className="px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground flex justify-between">Remettre en stock<button type="button" className="underline normal-case tracking-normal" onClick={() => setRestock(restock.length === o.items.length ? [] : o.items.map((l) => l.variantId))}>{restock.length === o.items.length ? "Aucune" : "Toutes"}</button></p>
              {o.items.map((l) => (
                <label key={l.variantId} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <input type="checkbox" className="accent-[#a82d64]" checked={restock.includes(l.variantId)} onChange={(ev) => setRestock(ev.target.checked ? [...restock, l.variantId] : restock.filter((x) => x !== l.variantId))} data-testid={`checkbox-restock-${l.variantId}`} />
                  <span className="flex-1">{l.productName} <span className="text-xs text-muted-foreground">{l.size} · {l.color} · x{l.quantity}</span></span>
                  <span className="text-[10px] uppercase">{restock.includes(l.variantId) ? "Stock" : "Abîmée"}</span>
                </label>
              ))}
            </div>
          )}
          <label className="block text-xs text-muted-foreground">Motif / note (obligatoire)
            <textarea className={`${inputCls} mt-1 min-h-16`} maxLength={500} value={reason} onChange={(ev) => setReason(ev.target.value)} data-testid="input-action-reason" /></label>
          {needsAttest && <label className="flex gap-2 items-start text-sm"><input type="checkbox" className="accent-[#a82d64] mt-1" checked={attest} onChange={(ev) => setAttest(ev.target.checked)} data-testid="checkbox-attest" />{attestText}</label>}
          {e && <p className="text-sm text-destructive" data-testid="text-action-error">{e}</p>}
          <button className={`${btnDark} w-full ${ACTION[sel]?.danger ? "!bg-destructive" : ""}`} onClick={go} data-testid="button-submit-action">{ACTION[sel]?.label ?? sel}</button>
        </fieldset>
      )}
    </section>
  );
}

export function PaymentPanel({ o, locked, submit, active, posLoading }: { o: AdminCheckoutOrder; locked: boolean; submit: Submit; active: RegisterSession | null; posLoading: boolean }) {
  const [chosenKind, setKind] = useState<"RECEIPT" | "REFUND">(o.canReceivePayment ? "RECEIPT" : "REFUND");
  // A returned order can accept a courier payout and a refund independently.
  // When one completes, switch to the remaining operation without a reload.
  const kind = o.canReceivePayment && o.canRefund ? chosenKind : o.canReceivePayment ? "RECEIPT" : "REFUND";
  const pickup = o.fulfillment === "PICKUP";
  const [method, setMethod] = useState<"CASH" | "BANK">("CASH");
  const [fee, setFee] = useState("");
  const [feeRefund, setFeeRefund] = useState("0");
  const [tendered, setTendered] = useState("");
  const [ref, setRef] = useState("");
  const [reason, setReason] = useState("");
  const [ack, setAck] = useState(false);
  const [e, setE] = useState("");
  const courier = kind === "RECEIPT" && o.collector === "COURIER";
  const m = kind === "RECEIPT" && pickup ? "CASH" : method;
  const feeM = courier ? parseMoney(fee) : 0;
  const feeRefundM = kind === "REFUND" ? parseMoney(feeRefund) : 0;
  // RECEIPT: amount = net received, net + withheld fee = original gross total.
  // REFUND: amount is INCLUSIVE = whole merchandise subtotal + chosen fee refund; feeMinor 0.
  const amount = kind === "RECEIPT" ? (feeM === null ? null : o.totalMinor - feeM) : feeRefundM === null ? null : o.subtotalMinor + feeRefundM;
  const tenderedM = m === "CASH" && kind === "RECEIPT" ? parseMoney(tendered) : null;
  const change = amount !== null && tenderedM !== null ? tenderedM - amount : null;
  const courierOwes = o.collector === "COURIER" && o.canReceivePayment && (o.refundedMinor > 0 || o.status === "RETURNING" || o.status === "RETURNED");
  const go = () => {
    setE("");
    const r = reason.trim();
    if (amount === null || amount < 0) { setE("Frais retenus invalides (montant exact, 0 accepté, au plus le total)."); return; }
    if (courier && !fee.trim()) { setE("Saisissez les frais réellement retenus par le transporteur (0 si aucun)."); return; }
    if (kind === "REFUND" && (feeRefundM === null || feeRefundM > o.feeMinor)) { setE(`Frais remboursés entre 0 et ${formatDA(o.feeMinor)}.`); return; }
    if (m === "CASH" && !active) { setE("Ouvrez d'abord un tiroir-caisse : l'espèce doit passer par une session."); return; }
    if (m === "CASH" && kind === "REFUND" && active && active.expectedMinor < amount) { setE(`Fonds insuffisants dans le tiroir (${formatDA(active.expectedMinor)} attendus) pour rendre ${formatDA(amount)}.`); return; }
    if (m === "CASH" && kind === "RECEIPT" && (tenderedM === null || tenderedM < amount)) { setE("Montant remis insuffisant."); return; }
    if (m === "BANK" && ref.trim().length < 3) { setE("Référence bancaire requise (3 caractères minimum)."); return; }
    if (r.length < 3) { setE("Motif requis (3 à 500 caractères)."); return; }
    if (!ack) { setE("Cochez la confirmation."); return; }
    const ok = submit((requestId) => ({ kind: "PAYMENT", body: {
      requestId, expectedStatus: o.status, kind, method: m, amountMinor: amount, feeMinor: courier ? feeM ?? 0 : 0,
      feeRefundMinor: kind === "REFUND" ? feeRefundM ?? 0 : 0, tenderedMinor: m === "CASH" && kind === "RECEIPT" ? tenderedM : null,
      registerSessionId: m === "CASH" ? active!.id : null, reference: m === "BANK" ? ref.trim().slice(0, 150) : "", reason: r.slice(0, 500),
    } }));
    if (ok) { setAck(false); setReason(""); setTendered(""); }
  };
  return (
    <section className="bg-card border border-primary/30 rounded-md p-5 space-y-4" data-testid="panel-payment">
      <div className="flex justify-between items-center gap-2">
        <h2 className="font-serif text-2xl flex items-center gap-2"><Banknote className="w-5 h-5 text-primary" strokeWidth={1.4} />Caisse</h2>
        {o.canReceivePayment && o.canRefund && (
          <div className="flex text-xs border border-border rounded-full overflow-hidden">
            {(["RECEIPT", "REFUND"] as const).map((k) => <button key={k} className={`px-3 py-1 ${kind === k ? "bg-[#282326] text-[#f6efe9]" : ""}`} onClick={() => { setKind(k); setAck(false); }} data-testid={`button-paykind-${k.toLowerCase()}`}>{k === "RECEIPT" ? "Encaisser" : "Rembourser"}</button>)}
          </div>
        )}
      </div>
      <fieldset disabled={locked} className="space-y-3">
        {courierOwes && kind === "RECEIPT" && (
          <p className="text-xs rounded-md border border-[#d98c62]/40 bg-[#fbf1ea] text-[#8a4a24] px-3 py-2" data-testid="status-courier-owes">
            Le transporteur doit toujours reverser le total brut de {formatDA(o.totalMinor)} (moins ses frais réels){o.refundedMinor > 0 ? ` : le remboursement de ${formatDA(o.refundedMinor)} a été versé par la boutique, pas par le transporteur.` : ", même si la commande revient."}
          </p>
        )}
        <p className="text-xs text-muted-foreground">{kind === "RECEIPT" ? (courier ? "Reversement du transporteur : saisissez le net reçu via les frais réellement retenus. Net + frais = total client." : pickup ? "Retrait au comptoir : espèces uniquement. Le stock sort au moment de l'encaissement." : "La cliente paie le total à la boutique.") : "Remboursement de la marchandise entière, plus les frais de livraison que vous choisissez de rendre."}</p>
        {!(kind === "RECEIPT" && pickup) && (
          <div className="grid grid-cols-2 gap-2">
            {(["CASH", "BANK"] as const).map((x) => <button key={x} type="button" onClick={() => setMethod(x)} data-testid={`button-method-${x.toLowerCase()}`} className={`py-2 rounded-md border text-sm ${method === x ? "border-[#282326] bg-[#282326] text-[#f6efe9]" : "border-border"}`}>{x === "CASH" ? "Espèces" : "Banque / CCP"}</button>)}
          </div>
        )}
        {m === "CASH" && <p className={`text-xs rounded px-3 py-2 ${active ? "bg-[#e3f0ea] text-[#2f6b4f]" : "bg-destructive/10 text-destructive"}`} data-testid="status-register">{posLoading ? "Vérification du tiroir..." : active ? `Tiroir #${active.id} ouvert par ${active.openedBy}` : <>Aucun tiroir ouvert. <Link href="/pos" className="underline">Ouvrir la caisse</Link></>}</p>}
        {courier && <Money label="Frais retenus par le transporteur (DA)" value={fee} onChange={setFee} testId="input-carrier-fee" />}
        {kind === "REFUND" && <Money label={`Frais rendus (0 à ${formatDA(o.feeMinor)})`} value={feeRefund} onChange={setFeeRefund} testId="input-fee-refund" />}
        {m === "CASH" && kind === "RECEIPT" && <Money label="Espèces remises (DA)" value={tendered} onChange={setTendered} testId="input-tendered" />}
        {m === "BANK" && <label className="block text-xs text-muted-foreground">Référence du virement<input className={`${inputCls} mt-1 font-mono`} maxLength={150} value={ref} onChange={(ev) => setRef(ev.target.value)} data-testid="input-bank-ref" /></label>}
        <dl className="text-sm bg-muted/50 rounded-md p-3 space-y-1">
          {kind === "RECEIPT" ? <>
            <Row k="Total brut cliente" v={formatDA(o.totalMinor)} />
            {courier && <Row k="Frais retenus" v={feeM === null ? "?" : `-${formatDA(feeM)}`} />}
            <Row k="Net reçu en boutique" v={amount === null || amount < 0 ? "?" : formatDA(amount)} strong />
            {change !== null && change >= 0 && <Row k="Monnaie à rendre" v={formatDA(change)} />}
          </> : <>
            <Row k="Marchandise entière" v={formatDA(o.subtotalMinor)} />
            <Row k="Frais rendus (choix)" v={feeRefundM === null ? "?" : formatDA(feeRefundM)} />
            <Row k="Montant remboursé (total)" v={amount === null ? "?" : formatDA(amount)} strong />
            {m === "CASH" && active && <Row k="Attendu dans le tiroir" v={formatDA(active.expectedMinor)} />}
          </>}
        </dl>
        <label className="block text-xs text-muted-foreground">Motif (obligatoire)<textarea className={`${inputCls} mt-1 min-h-14`} maxLength={500} value={reason} onChange={(ev) => setReason(ev.target.value)} data-testid="input-pay-reason" /></label>
        <label className="flex gap-2 items-start text-sm"><input type="checkbox" className="accent-[#a82d64] mt-1" checked={ack} onChange={(ev) => setAck(ev.target.checked)} data-testid="checkbox-pay-ack" />
          {kind === "RECEIPT" ? "Je confirme avoir réellement reçu ce montant. L'enregistrement est définitif." : "Je confirme rendre ce montant à la cliente. L'enregistrement est définitif."}</label>
        {e && <p className="text-sm text-destructive" data-testid="text-pay-error">{e}</p>}
        <button className={`${btnDark} w-full`} onClick={go} data-testid="button-submit-payment">{kind === "RECEIPT" ? "Enregistrer l'encaissement" : "Enregistrer le remboursement"}</button>
      </fieldset>
    </section>
  );
}

