import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useRefundPosSale, useCancelPosRefundRequest, type PosSale, type RegisterSession, type RefundInput } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { btnDark, btnGhost, inputCls } from "@/components/admin/shell-primitives";
import { formatDA, errMsg } from "@/lib/util";
import { classify, newRequestId, refundEstimate, loadPendingRefund, savePendingRefund, useInvalidatePos, type Outcome } from "@/lib/pos";

export function canVoid(sale: PosSale, active: RegisterSession | null) {
  return sale.status === "COMPLETED" && sale.refunds.length === 0 && !!active && active.status === "OPEN" && active.id === sale.registerSessionId;
}

export function RefundDialog({ sale, active, userId, kind, open, onClose, request, onRefresh }: {
  sale: PosSale; active: RegisterSession; userId: number; kind: "RETURN" | "VOID"; open: boolean; onClose: () => void;
  request: { headers: Record<string, string> }; onRefresh: () => void;
}) {
  const [qty, setQty] = useState<Record<number, number>>({});
  const [restock, setRestock] = useState<Record<number, boolean>>({});
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState<RefundInput | null>(() => loadPendingRefund(userId, sale.id));
  const [outcome, setOutcome] = useState<{ kind: Outcome; e: unknown } | null>(null);
  const [step, setStep] = useState<"edit" | "confirm">("edit");
  const refund = useRefundPosSale({ request });
  const cancel = useCancelPosRefundRequest({ request });
  const [cancelErr, setCancelErr] = useState<unknown>(null);
  const abandon = () => {
    if (!pending) return;
    if (!confirm("Demander au serveur d'annuler définitivement cette demande de remboursement ?")) return;
    setCancelErr(null);
    cancel.mutate({ data: { requestId: pending.requestId, registerSessionId: pending.registerSessionId, saleId: sale.id } }, {
      onSuccess: (r) => {
        savePendingRefund(userId, sale.id, null); setPending(null); setOutcome(null); invalidate(); onRefresh();
        if (!r.cancelled) onClose(); // refund was already confirmed: show updated ticket
        else setStep("edit");
      },
      onError: (e) => setCancelErr(e),
    });
  };
  const invalidate = useInvalidatePos();

  useEffect(() => {
    if (!open) return;
    const q: Record<number, number> = {}, r: Record<number, boolean> = {};
    for (const l of sale.items) { q[l.id] = kind === "VOID" ? l.quantity : 0; r[l.id] = true; }
    setQty(q); setRestock(r); setReason(""); setStep("edit"); setOutcome(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, kind]);

  useEffect(() => {
    if (!pending) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [pending]);

  const lines = sale.items.map((l) => {
    const left = l.quantity - l.refundedQuantity;
    const n = Math.max(0, Math.min(qty[l.id] ?? 0, left));
    return { l, left, n, est: refundEstimate(l.lineTotalMinor, l.quantity, l.refundedQuantity, n) };
  });
  const total = lines.reduce((a, x) => a + x.est, 0);
  const chosen = lines.filter((x) => x.n > 0);
  const valid = chosen.length > 0 && reason.trim().length >= 3 && reason.trim().length <= 500;

  const send = (p: RefundInput) => {
    setOutcome(null);
    refund.mutate({ id: sale.id, data: p }, {
      onSuccess: () => { savePendingRefund(userId, sale.id, null); setPending(null); invalidate(); onRefresh(); onClose(); },
      onError: (e) => {
        const k = classify(e);
        setOutcome({ kind: k, e }); invalidate(); onRefresh();
      },
    });
  };
  const submit = () => {
    const p: RefundInput = {
      requestId: newRequestId(), registerSessionId: active.id, kind, reason: reason.trim(),
      items: chosen.map((x) => ({ saleItemId: x.l.id, quantity: x.n, restock: kind === "VOID" ? true : !!restock[x.l.id] })),
    };
    savePendingRefund(userId, sale.id, p); setPending(p); send(p);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !refund.isPending && !cancel.isPending) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto" dir="ltr">
        <DialogHeader>
          <DialogTitle className="font-serif text-3xl font-normal">{kind === "VOID" ? `Annuler le ticket ${sale.number}` : `Retour sur ${sale.number}`}</DialogTitle>
          <DialogDescription>Le remboursement sort du tiroir actif (session {active.id}). Le ticket original reste conservé.</DialogDescription>
        </DialogHeader>

        {pending ? (
          <div className="rounded-md bg-[#fbf1ea] border border-secondary/30 p-4 text-sm space-y-2" data-testid="status-refund-pending">
            <p className="flex gap-2 font-medium"><AlertTriangle className="w-4 h-4 text-secondary mt-0.5" />{refund.isPending ? "Envoi du remboursement…" : outcome?.kind === "conflict" ? "Conflit signalé" : "Résultat du remboursement inconnu"}</p>
            <p className="text-xs">Demande verrouillée ({pending.kind}, {pending.items.length} ligne(s)). Réessayer renvoie exactement la même demande : pas de double remboursement. Pour modifier, annulez d'abord la demande auprès du serveur.</p>
            {outcome?.e != null && <p className="text-xs text-destructive">{errMsg(outcome.e)}</p>}
            {cancelErr != null && <p className="text-xs text-destructive">Annulation non confirmée, la demande reste verrouillée : {errMsg(cancelErr)}</p>}
            <div className="flex flex-wrap gap-2">
              <button className={`${btnDark} !px-3 !py-1.5 text-xs`} disabled={refund.isPending || cancel.isPending} onClick={() => send(pending)} data-testid="button-retry-refund">Réessayer à l'identique</button>
              <button className={`${btnGhost} !px-3 !py-1.5 text-xs`} disabled={refund.isPending} onClick={onRefresh}>Actualiser le ticket</button>
              <button className={`${btnGhost} !px-3 !py-1.5 text-xs hover:!border-destructive hover:!text-destructive`} disabled={refund.isPending || cancel.isPending} onClick={abandon} data-testid="button-cancel-refund-request">{cancel.isPending ? "Annulation…" : "Annuler cette demande"}</button>
            </div>
          </div>
        ) : (
          <>
            <div className="border border-border rounded-md divide-y divide-border">
              {lines.map(({ l, left, n, est }) => (
                <div key={l.id} className="grid grid-cols-[1fr_auto] md:grid-cols-[1fr_auto_auto_auto] gap-3 items-center p-3 text-sm" data-testid={`row-refund-${l.id}`}>
                  <div className="min-w-0">
                    <p className="truncate">{l.productName} <span className="text-muted-foreground">· {l.size} / {l.color}</span></p>
                    <p className="text-[11px] text-muted-foreground">Vendu {l.quantity} · déjà rendu {l.refundedQuantity} · ligne {formatDA(l.lineTotalMinor)}</p>
                  </div>
                  {kind === "RETURN" ? (
                    <input type="number" min={0} max={left} disabled={left === 0 || step === "confirm"} value={n}
                      onChange={(e) => setQty({ ...qty, [l.id]: Math.max(0, Math.min(left, parseInt(e.target.value || "0", 10) || 0)) })}
                      className="w-16 px-2 py-1 rounded border border-input bg-background font-mono text-right" data-testid={`input-refund-qty-${l.id}`} />
                  ) : <span className="font-mono text-xs">x{n}</span>}
                  <label className={`flex items-center gap-1.5 text-xs ${kind === "VOID" ? "opacity-60" : ""}`}>
                    <input type="checkbox" className="accent-[#F04F94]" disabled={kind === "VOID" || n === 0 || step === "confirm"} checked={kind === "VOID" ? true : !!restock[l.id]}
                      onChange={(e) => setRestock({ ...restock, [l.id]: e.target.checked })} data-testid={`checkbox-restock-${l.id}`} />
                    Remettre en stock
                  </label>
                  <span className="font-mono text-right w-24">{n ? `-${formatDA(est)}` : ""}</span>
                </div>
              ))}
            </div>
            {kind === "RETURN" && <p className="text-[11px] text-muted-foreground">Décochez « Remettre en stock » pour un article abîmé : il ne reviendra pas en vente.</p>}
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Motif (obligatoire)</span>
              <textarea rows={2} maxLength={500} disabled={step === "confirm"} className={`${inputCls} mt-1`} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="input-refund-reason" />
            </label>
            <div className="flex items-center justify-between rounded-md bg-[#282326] text-[#f6efe9] px-4 py-3">
              <span className="text-xs uppercase tracking-wider">À rendre en espèces (estimation)</span>
              <span className="font-mono text-xl" data-testid="text-refund-estimate">{formatDA(total)}</span>
            </div>
            <p className="text-[11px] text-muted-foreground">Le serveur calcule le montant exact et refuse si le tiroir manque d'espèces.</p>
            {outcome && <p className="text-sm text-destructive">{errMsg(outcome.e)}</p>}
            <div className="flex justify-end gap-2">
              {step === "edit" ? (
                <>
                  <button className={btnGhost} onClick={onClose}>Fermer</button>
                  <button className={btnDark} disabled={!valid} onClick={() => setStep("confirm")} data-testid="button-refund-next">Vérifier</button>
                </>
              ) : (
                <>
                  <button className={btnGhost} onClick={() => setStep("edit")}>Modifier</button>
                  <button className={`${btnDark} !bg-destructive`} onClick={submit} data-testid="button-refund-confirm">Confirmer {kind === "VOID" ? "l'annulation" : "le retour"} · {formatDA(total)}</button>
                </>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
