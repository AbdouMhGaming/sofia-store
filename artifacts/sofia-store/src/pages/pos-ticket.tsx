import { useState } from "react";
import { Link, useParams } from "wouter";
import { ArrowLeft, Printer, Undo2, Ban, AlertTriangle } from "lucide-react";
import { useGetPosSale, getGetPosSaleQueryKey } from "@workspace/api-client-react";
import { AdminShell } from "@/pages/admin";
import { btnDark, btnGhost, Skel, ErrorText } from "@/components/admin/shell-primitives";
import { PosTabs } from "@/components/pos/pos-tabs";
import { Receipt, type PaperWidth } from "@/components/pos/receipt";
import { RefundDialog, canVoid } from "@/components/pos/refund-dialog";
import { usePos, loadPendingRefund, fmtDate, REFUND_KIND, SALE_STATUS } from "@/lib/pos";
import { formatDA } from "@/lib/util";

const W_KEY = "sofia-pos-paper";

export function PosTicketPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const { enabled, ctx, user, request } = usePos();
  const q = useGetPosSale(id, { query: { queryKey: getGetPosSaleQueryKey(id), enabled: enabled && Number.isSafeInteger(id) && id > 0 } });
  const [width, setWidth] = useState<PaperWidth>(() => (localStorage.getItem(W_KEY) === "58" ? 58 : 80));
  const [dlg, setDlg] = useState<"RETURN" | "VOID" | null>(null);
  const sale = q.data;
  const c = ctx.data;
  const active = c?.activeSession ?? null;
  const setW = (w: PaperWidth) => { setWidth(w); localStorage.setItem(W_KEY, String(w)); };
  const returnable = sale ? sale.items.some((l) => l.refundedQuantity < l.quantity) && sale.status !== "VOIDED" : false;

  return (
    <AdminShell title={sale ? `Ticket ${sale.number}` : "Ticket"} sub="Copie fidèle de la vente enregistrée. Non modifiable.">
      <PosTabs />
      <Link href="/pos/historique" className="text-sm text-muted-foreground hover:text-primary inline-flex items-center gap-1 mb-4 no-print"><ArrowLeft className="w-3.5 h-3.5" />Tous les tickets</Link>
      {!Number.isSafeInteger(id) || id <= 0 ? <ErrorText e={new Error("Identifiant de ticket invalide.")} />
        : q.isLoading || !enabled ? <div className="grid md:grid-cols-[auto_1fr] gap-8"><Skel h="h-[520px] w-[300px]" /><Skel h="h-64" /></div>
        : q.isError ? <div className="max-w-md"><ErrorText e={q.error} /><button className={`${btnGhost} mt-3`} onClick={() => q.refetch()}>Réessayer</button></div>
        : sale && (
          <div className="grid lg:grid-cols-[auto_1fr] gap-8 items-start">
            <div className="bg-[#efe6df] rounded-md p-6 md:p-8 overflow-x-auto"><Receipt sale={sale} width={width} /></div>
            <div className="space-y-5 no-print">
              <div className="bg-card border border-border rounded-md p-5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full ${SALE_STATUS[sale.status]?.[1]}`} data-testid="status-sale">{SALE_STATUS[sale.status]?.[0] ?? sale.status}</span>
                  <span className="text-sm text-muted-foreground">{fmtDate(sale.createdAt)} · Alger</span>
                </div>
                <p className="font-serif text-4xl mt-2">{formatDA(sale.totalMinor)}</p>
                {sale.refundedMinor > 0 && <p className="text-sm text-destructive">Remboursé : {formatDA(sale.refundedMinor)}</p>}
                {(!sale.receiptSettings.address || !sale.receiptSettings.phone) && (
                  <p className="mt-3 text-xs flex gap-2 text-[#8a4a24] bg-[#fbf1ea] rounded px-3 py-2"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    Adresse ou téléphone absent de ce ticket. {c?.canManage ? <Link href="/pos/reglages" className="underline">Compléter pour les prochaines ventes</Link> : "Un responsable peut les ajouter pour les prochaines ventes."}</p>
                )}
              </div>

              <div className="bg-card border border-border rounded-md p-5 space-y-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Impression</p>
                <div className="flex gap-1 p-1 rounded-full bg-muted w-fit">
                  {([58, 80] as const).map((w) => (
                    <button key={w} onClick={() => setW(w)} className={`px-4 py-1 rounded-full text-sm transition ${width === w ? "bg-[#282326] text-[#f6efe9]" : ""}`} data-testid={`button-width-${w}`}>{w} mm</button>
                  ))}
                </div>
                <button className={btnDark} onClick={() => window.print()} data-testid="button-print"><Printer className="w-4 h-4" />Imprimer / réimprimer</button>
                <p className="text-[11px] text-muted-foreground">Choisissez le même papier ({width} mm) et des marges nulles dans la boîte d'impression. La réimpression ne crée aucun paiement. Ce ticket n'est pas une facture fiscale.</p>
              </div>

              {c?.canManage && (
                <div className="bg-card border border-border rounded-md p-5 space-y-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Retour ou annulation (responsable)</p>
                  {user && active && (() => { const stored = loadPendingRefund(user.id, sale.id); const pr = stored.ok ? stored.value : null; return (!stored.ok || pr) && !dlg ? (
                    <button className="w-full text-left text-xs rounded px-3 py-2 bg-[#fbf1ea] text-[#8a4a24] border border-secondary/30" onClick={() => setDlg(pr?.kind ?? "RETURN")} data-testid="button-resume-refund">
                      Un remboursement dont le résultat est inconnu est en attente sur cet onglet. Ouvrir pour vérifier ou réessayer à l'identique.</button>) : null; })()}
                  {!active ? <p className="text-sm text-muted-foreground">Ouvrez un tiroir pour rembourser en espèces.</p> : (
                    <div className="flex flex-wrap gap-2">
                      {returnable && <button className={btnGhost} onClick={() => setDlg("RETURN")} data-testid="button-return"><Undo2 className="w-4 h-4" />Retour partiel</button>}
                      {canVoid(sale, active) && <button className={`${btnGhost} hover:!border-destructive hover:!text-destructive`} onClick={() => setDlg("VOID")} data-testid="button-void"><Ban className="w-4 h-4" />Annuler la vente</button>}
                      {!returnable && <p className="text-sm text-muted-foreground">Tous les articles ont déjà été rendus.</p>}
                    </div>
                  )}
                </div>
              )}

              <div className="bg-card border border-border rounded-md p-5">
                <p className="text-xs uppercase tracking-wide text-muted-foreground mb-3">Historique des remboursements</p>
                {sale.refunds.length === 0 ? <p className="text-sm text-muted-foreground">Aucun.</p> : (
                  <ol className="space-y-3">
                    {sale.refunds.map((r) => (
                      <li key={r.id} className="text-sm border-s-2 border-primary/40 ps-3" data-testid={`row-refund-history-${r.id}`}>
                        <p><span className="font-medium">{REFUND_KIND[r.kind] ?? r.kind} {r.number}</span> · <span className="font-mono">-{formatDA(r.amountMinor)}</span></p>
                        <p className="text-xs text-muted-foreground">{fmtDate(r.createdAt)} · par n° {r.actorId} · tiroir {r.registerSessionId}</p>
                        <p className="text-xs">{r.reason}</p>
                        <p className="text-[11px] text-muted-foreground">{r.items.map((it) => { const l = sale.items.find((x) => x.id === it.saleItemId); return `${it.quantity} x ${l?.sku ?? it.saleItemId}${it.restock ? "" : " (non remis en stock)"}`; }).join(" · ")}</p>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          </div>
        )}
      {sale && active && user && dlg && (
        <RefundDialog sale={sale} active={active} userId={user.id} kind={dlg} open={!!dlg} onClose={() => setDlg(null)} request={request} onRefresh={() => q.refetch()} />
      )}
    </AdminShell>
  );
}
