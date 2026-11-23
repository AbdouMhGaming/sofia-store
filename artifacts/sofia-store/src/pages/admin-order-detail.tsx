import { useRef, useState } from "react";
import { Link, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Package, Printer, RefreshCw, Search, Truck, Vault } from "lucide-react";
import {
  useGetAdminOrder, getGetAdminOrderQueryKey, useGetPosContext, getGetPosContextQueryKey,
  useActOnAdminOrder, useRecordAdminOrderPayment, useRecoverAdminOrderRequest, getRecoverAdminOrderRequestQueryKey, useAbandonAdminOrderRequest,
  type AdminCheckoutOrder, type WebOrderRequestResult,
} from "@workspace/api-client-react";
import { useSessionCsrf } from "@/lib/auth";
import { formatDA, errMsg } from "@/lib/util";
import { fmtDate, fmtDateLong, classify, STORAGE_CORRUPT_MESSAGE, STORAGE_WRITE_ERROR, STORAGE_CLEANUP_WARNING } from "@/lib/pos";
import { useInvalidateCommerce, newUuid } from "@/lib/shop";
import { readPendingOp, writePendingOp, storedMatches, clearPendingOp, type PendingOp } from "@/lib/web-order-pending";
import { AdminShell } from "@/pages/admin";
import { btnDark, btnGhost, ErrorText, Skel } from "@/components/admin/shell-primitives";
import { ActionPanel, PaymentPanel, type Submit } from "@/components/admin/order-panels";
import { StatusBadge, PAY_STATUS, GOODS, ACTION, Flow, Row, Alert } from "@/components/admin/order-ui";
export { ORDER_STATUS, StatusBadge, PAY_STATUS } from "@/components/admin/order-ui";
export { AdminOrderReceiptPage } from "@/pages/admin-order-receipt";

export function AdminOrderDetailPage() {
  const { id: raw = "" } = useParams<{ id: string }>();
  const id = Number(raw);
  const valid = Number.isSafeInteger(id) && id > 0;
  const { session } = useSessionCsrf();
  const user = session.data?.user;
  // Cashiers are redirected by AdminShell; never fire admin reads for them.
  const staff = !!user && !user.mustChangePassword && (user.role === "STORE_OWNER" || user.role === "MANAGER");
  const q = useGetAdminOrder(id, { query: { queryKey: getGetAdminOrderQueryKey(id), enabled: valid && staff, refetchInterval: 20_000 } });
  const o = q.data;
  return (
    <AdminShell title={o ? `Commande ${o.reference}` : "Commande"} sub={o ? `${o.customerName} · créée le ${fmtDate(o.createdAt)}` : undefined}
      actions={<Link href="/admin/commandes" className={btnGhost} data-testid="link-back-orders"><ArrowLeft className="w-4 h-4" />Commandes</Link>}>
      {!valid ? <p>Identifiant invalide.</p> : q.isLoading || !user || !staff ? <Skel h="h-96" /> : q.isError || !o ? (
        <div className="space-y-3"><ErrorText e={q.error} /><button className={btnGhost} onClick={() => q.refetch()}>Réessayer</button></div>
      ) : <OrderOps key={`${user.id}:${o.id}`} o={o} userId={user.id} />}
    </AdminShell>
  );
}

function OrderOps({ o, userId }: { o: AdminCheckoutOrder; userId: number }) {
  const { request, token, session } = useSessionCsrf();
  const qc = useQueryClient();
  const invalidate = useInvalidateCommerce();
  const [loaded] = useState(() => readPendingOp(userId));
  const blocked = !loaded.ok;
  const [pending, setPendingState] = useState<PendingOp | null>(loaded.ok ? loaded.value : null);
  const lock = useRef(false);
  const [err, setErr] = useState<{ e: unknown; uncertain: boolean } | null>(null);
  const [msg, setMsg] = useState("");
  const [warn, setWarn] = useState(blocked ? STORAGE_CORRUPT_MESSAGE : "");
  const act = useActOnAdminOrder({ request });
  const pay = useRecordAdminOrderPayment({ request });
  const abandonM = useAbandonAdminOrderRequest({ request });
  const recover = useRecoverAdminOrderRequest(pending?.orderId ?? 0, pending?.body.requestId ?? "", {
    query: { enabled: false, retry: false, queryKey: getRecoverAdminOrderRequestQueryKey(pending?.orderId ?? 0, pending?.body.requestId ?? "") },
  });
  const pos = useGetPosContext({ query: { queryKey: getGetPosContextQueryKey(), refetchInterval: 20_000 } });
  const active = pos.data?.activeSession && pos.data.activeSession.status === "OPEN" ? pos.data.activeSession : null;
  const csrfReady = !!token && !session.isFetching && !session.isError;
  const busy = act.isPending || pay.isPending || abandonM.isPending || recover.isFetching;
  const otherOrder = pending && pending.orderId !== o.id;
  const locked = blocked || !!pending || busy || !csrfReady;

  const applyOrder = (next: AdminCheckoutOrder) => { qc.setQueryData(getGetAdminOrderQueryKey(next.id), next); invalidate(); };
  const clearPending = (done: string) => {
    // Erase verified before unlocking; if it fails the lock stays while the confirmed result is visible.
    if (!clearPendingOp(userId)) { setWarn(STORAGE_CLEANUP_WARNING); setMsg(done); return; }
    setPendingState(null); setErr(null); setWarn(""); setMsg(done);
  };
  const send = (p: PendingOp) => {
    // Every (re)send re-verifies storage still holds exactly this request for this operator.
    if (p.userId !== userId || !storedMatches(userId, p)) { lock.current = false; setWarn(STORAGE_CORRUPT_MESSAGE); return; }
    setErr(null); setMsg("");
    const opts = {
      onSuccess: (next: AdminCheckoutOrder) => { applyOrder(next); clearPending(p.kind === "PAYMENT" ? "Paiement enregistré." : "Opération enregistrée."); },
      onError: (e: unknown) => { setErr({ e, uncertain: classify(e) === "uncertain" }); invalidate(); },
      onSettled: () => { lock.current = false; },
    };
    if (p.kind === "ACTION") act.mutate({ id: p.orderId, data: p.body }, opts);
    else pay.mutate({ id: p.orderId, data: p.body }, opts);
  };
  const submit: Submit = (make) => {
    if (lock.current || pending || blocked || !csrfReady) return false;
    lock.current = true;
    let requestId: string;
    try { requestId = newUuid(); } catch { lock.current = false; setWarn(STORAGE_WRITE_ERROR); return false; }
    const p: PendingOp = { orderId: o.id, userId, ...make(requestId) };
    if (!writePendingOp(userId, p)) { lock.current = false; setWarn(STORAGE_WRITE_ERROR); return false; }
    setPendingState(p);
    send(p);
    return true;
  };
  const handleResult = (r: WebOrderRequestResult) => {
    if (!pending) return;
    if (r.order && r.order.id !== pending.orderId) { setErr({ e: new Error("Réponse pour une autre commande : demande toujours verrouillée."), uncertain: true }); return; }
    if (r.order) applyOrder(r.order);
    clearPending(r.state === "COMPLETED" ? "Le serveur confirme : l'opération a bien été enregistrée." : "Le serveur confirme : la demande est annulée définitivement. Rien n'a été enregistré.");
  };
  const verify = async () => {
    if (!pending || busy) return;
    setErr(null); setMsg("");
    const r = await recover.refetch();
    if (r.data) handleResult(r.data);
    else setErr({ e: r.error, uncertain: true });
  };
  const abandon = () => {
    if (!pending || busy || !csrfReady || !window.confirm("Demander au serveur d'annuler définitivement cette demande ? Si elle a déjà été enregistrée, le résultat sera affiché.")) return;
    setErr(null); setMsg("");
    abandonM.mutate({ id: pending.orderId, data: { requestId: pending.body.requestId } }, {
      onSuccess: handleResult,
      onError: (e) => setErr({ e, uncertain: classify(e) === "uncertain" }),
    });
  };

  const isDel = o.fulfillment === "DELIVERY";
  const terminal = ["CANCELLED", "EXPIRED"].includes(o.status);
  const customerPaid = o.paymentStatus === "COLLECTED_BY_COURIER" || o.paymentStatus === "PAID" || o.storeReceivedMinor > 0;

  return (
    <div className="space-y-6">
      {warn && <Alert tone="danger" testId="status-storage">{warn}</Alert>}
      {!csrfReady && <Alert tone="info" testId="status-csrf">Connexion de sécurité en cours de vérification...{session.isError && <button className="underline ms-2" onClick={() => void session.refetch()}>Réessayer</button>}</Alert>}

      {pending && (
        <section className="border border-[#d98c62]/50 bg-[#fbf1ea] rounded-md p-5" data-testid="panel-pending-op">
          <div className="flex gap-3 items-start">
            <AlertTriangle className="w-5 h-5 text-[#a65429] shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0 text-sm">
              <p className="font-serif text-2xl">Demande en attente de confirmation</p>
              <p className="mt-1 text-[#8a4a24]">
                {pending.kind === "PAYMENT" ? `${pending.body.kind === "REFUND" ? "Remboursement" : "Encaissement"} ${pending.body.method === "CASH" ? "espèces" : "banque"} ${formatDA(pending.body.amountMinor)}` : ACTION[pending.body.action]?.label ?? pending.body.action} · commande #{pending.orderId}
                {" · "}clé <span className="font-mono text-xs">{pending.body.requestId.slice(0, 8)}</span>. Aucune nouvelle opération tant que le serveur n'a pas tranché.
              </p>
              {otherOrder ? (
                <p className="mt-3">Cette demande concerne une autre commande. <Link href={`/admin/commandes/${pending.orderId}`} className="text-primary link-underline" data-testid="link-pending-order">Ouvrir la commande #{pending.orderId}</Link></p>
              ) : (
                <div className="flex flex-wrap gap-2 mt-4">
                  <button className={btnDark} disabled={busy || !csrfReady} onClick={() => { if (!lock.current) { lock.current = true; send(pending); } }} data-testid="button-retry-op"><RefreshCw className="w-4 h-4" />{act.isPending || pay.isPending ? "Envoi..." : "Renvoyer à l'identique"}</button>
                  <button className={btnGhost} disabled={busy} onClick={verify} data-testid="button-verify-op"><Search className="w-4 h-4" />{recover.isFetching ? "Vérification..." : "Vérifier sur le serveur"}</button>
                  <button className={`${btnGhost} hover:!text-destructive`} disabled={busy || !csrfReady} onClick={abandon} data-testid="button-abandon-op">{abandonM.isPending ? "Annulation..." : "Annuler cette demande"}</button>
                </div>
              )}
            </div>
          </div>
        </section>
      )}
      {err && err.e != null && <Alert tone="danger" testId="text-op-error">{err.uncertain ? "Résultat inconnu : la demande reste verrouillée. Vérifiez avant toute autre action. " : "Refusé par le serveur. La demande reste verrouillée jusqu'à vérification ou annulation. "}{errMsg(err.e)}</Alert>}
      {msg && <Alert tone="ok" testId="status-op-ok">{msg}</Alert>}

      {/* Three flows: garments / courier / till */}
      <section className="grid md:grid-cols-[1fr_1fr_1fr] gap-px bg-border border border-border rounded-md overflow-hidden" data-testid="panel-flows">
        <Flow icon={<Package className="w-4 h-4" />} k="Marchandise" v={GOODS[o.status] ?? o.status} sub={<><StatusBadge s={o.status} />{o.status === "PENDING" && <span className="ms-2">expire {fmtDate(o.expiresAt)}</span>}</>} />
        <Flow icon={<Truck className="w-4 h-4" />} k="Transporteur" v={!isDel ? "Retrait boutique : sans transporteur" : o.collector === "COURIER" ? (o.courierOutstandingMinor > 0 ? `Doit ${formatDA(o.courierOutstandingMinor)} à la boutique` : o.paymentStatus === "COLLECTED_BY_COURIER" || o.payments.some(p => p.kind === "RECEIPT") ? "Rien à reverser" : "N'a pas encore encaissé") : o.collector === "STAFF" ? "N'encaisse pas : paiement au personnel" : "Encaisseur non choisi"}
          sub={<>{o.carrierName || o.trackingNumber ? <span>{o.carrierName}{o.trackingNumber && <> · <span className="font-mono">{o.trackingNumber}</span></>}</span> : <span>Pas encore remis</span>}</>} />
        <div className="bg-[#282326] text-[#f6efe9] p-4">
          <p className="text-[10px] uppercase tracking-wider opacity-70 flex items-center gap-2"><Vault className="w-4 h-4" />Reçu par la boutique</p>
          <p className="font-serif text-3xl mt-1 tabular-nums" data-testid="text-store-received">{formatDA(o.storeReceivedMinor)}</p>
          <p className="text-xs opacity-75 mt-1">{PAY_STATUS[o.paymentStatus] ?? o.paymentStatus}{o.carrierFeesMinor > 0 && ` · frais retenus ${formatDA(o.carrierFeesMinor)}`}{o.refundedMinor > 0 && ` · remboursé ${formatDA(o.refundedMinor)}`}</p>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-6 items-start">
        <div className="space-y-6 min-w-0 break-words">
          <section className="bg-card border border-border rounded-md p-5">
            <div className="flex justify-between items-baseline"><h2 className="font-serif text-2xl">Pièces</h2><span className="text-xs text-muted-foreground">{o.paymentMethod === "COD" ? "Paiement à la livraison" : "Paiement au retrait"}</span></div>
            <ul className="divide-y divide-border mt-2">
              {o.items.map((l) => (
                <li key={l.variantId} className="py-2.5 flex justify-between gap-4 text-sm">
                  <span className="min-w-0 flex-1">{l.productName}<span className="block text-xs text-muted-foreground font-mono break-all">{l.sku} · {l.size} · {l.color} · x{l.quantity} · {formatDA(l.unitPriceMinor)}</span></span>
                  <span className="tabular-nums shrink-0 whitespace-nowrap">{formatDA(l.lineTotalMinor)}</span>
                </li>
              ))}
            </ul>
            <dl className="text-sm border-t border-border pt-3 space-y-1">
              <Row k="Sous-total marchandise" v={formatDA(o.subtotalMinor)} />
              <Row k="Frais de livraison / retrait" v={formatDA(o.feeMinor)} />
              <div className="flex justify-between font-serif text-xl pt-1"><dt>Total brut cliente</dt><dd data-testid="text-order-total">{formatDA(o.totalMinor)}</dd></div>
              <Row k="Frais retenus par le transporteur" v={o.carrierFeesMinor ? `-${formatDA(o.carrierFeesMinor)}` : "-"} />
              <Row k="Net reçu par la boutique" v={formatDA(o.storeReceivedMinor)} strong />
              {o.refundedMinor > 0 && <Row k="Remboursé à la cliente" v={`-${formatDA(o.refundedMinor)}`} />}
              {terminal && !customerPaid && <p className="text-xs text-muted-foreground pt-1">Aucun montant dû.</p>}
            </dl>
          </section>

          <section className="bg-card border border-border rounded-md p-5" data-testid="panel-payments">
            <h2 className="font-serif text-2xl mb-2">Paiements enregistrés</h2>
            {o.payments.length === 0 ? <p className="text-sm text-muted-foreground">Aucun mouvement d'argent enregistré en boutique.</p> : (
              <div className="overflow-x-auto"><table className="w-full text-sm min-w-[520px]">
                <thead className="text-[10px] uppercase tracking-wider text-muted-foreground"><tr className="text-start"><th className="text-start py-1">N°</th><th className="text-start">Type</th><th className="text-end">Montant</th><th className="text-end">Frais</th><th className="text-start ps-3">Date</th><th /></tr></thead>
                <tbody>{o.payments.map((p) => (
                  <tr key={p.id} className="border-t border-border" data-testid={`row-payment-${p.id}`}>
                    <td className="py-2 font-mono text-xs">{p.number}</td>
                    <td>{p.kind === "REFUND" ? "Remboursement" : "Encaissement"} · {p.method === "CASH" ? `Espèces${p.registerSessionId ? ` #${p.registerSessionId}` : ""}` : "Banque"}</td>
                    <td className={`text-end font-mono ${p.kind === "REFUND" ? "text-destructive" : ""}`}>{p.kind === "REFUND" ? "-" : ""}{formatDA(p.amountMinor)}</td>
                    <td className="text-end font-mono text-xs">{p.feeMinor ? formatDA(p.feeMinor) : p.feeRefundMinor ? `dont ${formatDA(p.feeRefundMinor)}` : "-"}</td>
                    <td className="ps-3 whitespace-nowrap text-xs">{fmtDate(p.createdAt)}</td>
                    <td className="text-end"><Link href={`/admin/commandes/${o.id}/recu/${p.id}`} className="inline-flex items-center gap-1 text-primary text-xs link-underline" data-testid={`link-receipt-${p.id}`}><Printer className="w-3.5 h-3.5" />Reçu</Link></td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </section>

          <section className="bg-card border border-border rounded-md p-5">
            <h2 className="font-serif text-2xl mb-3">Historique</h2>
            <ol className="relative border-s border-border ms-1.5 space-y-3 text-sm">
              {o.events.map((e, i) => (
                <li key={i} className="ps-4 relative"><span className="absolute -start-[5px] top-1.5 w-2.5 h-2.5 rounded-full bg-primary/70" />
                  <span className="text-xs text-muted-foreground">{fmtDateLong(e.createdAt)}</span> <span className="font-medium">{ACTION[e.kind]?.label ?? e.kind}</span>
                  {e.reason && <p className="text-muted-foreground">{e.reason}</p>}</li>
              ))}
            </ol>
          </section>
        </div>

        <div className="space-y-6 min-w-0 break-words">
          <section className="bg-card border border-border rounded-md p-5 text-sm space-y-1.5" data-testid="panel-customer">
            <h2 className="font-serif text-2xl mb-1">Cliente</h2>
            <p className="font-medium">{o.customerName}</p>
            <p dir="ltr" className="text-start"><a href={`tel:${o.customerPhone}`} className="text-primary link-underline">{o.customerPhone}</a></p>
            <p>{isDel ? `Livraison ${o.deliveryMode === "DESK" ? "bureau" : "domicile"} · ${o.zoneNameFr}` : `Retrait · ${o.pickupAddressFr}`}</p>
            {isDel && <p className="text-muted-foreground">{o.commune}{o.address && <><br />{o.address}</>}</p>}
            {o.deliveryMinDays !== null && <p className="text-xs text-muted-foreground">Délai annoncé : {o.deliveryMinDays}–{o.deliveryMaxDays} jours</p>}
            {o.notes && <p className="text-muted-foreground border-t border-border pt-2">{o.notes}</p>}
          </section>
          {!otherOrder && <ActionPanel o={o} locked={locked} submit={submit} />}
          {!otherOrder && (o.canReceivePayment || o.canRefund) && <PaymentPanel o={o} locked={locked} submit={submit} active={active} posLoading={pos.isLoading} />}
        </div>
      </div>
    </div>
  );
}

