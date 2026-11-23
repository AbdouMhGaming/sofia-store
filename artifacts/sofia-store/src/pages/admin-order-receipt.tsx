import { Link, useParams } from "wouter";
import { ArrowLeft, Printer } from "lucide-react";
import { useGetAdminOrder, getGetAdminOrderQueryKey, type AdminCheckoutOrder, type WebOrderPayment } from "@workspace/api-client-react";
import { useSessionCsrf } from "@/lib/auth";
import { formatDA } from "@/lib/util";
import { fmtDateLong } from "@/lib/pos";
import { AdminShell } from "@/pages/admin";
import { btnDark, btnGhost, ErrorText, Skel } from "@/components/admin/shell-primitives";

export function AdminOrderReceiptPage() {
  const { id: raw = "", paymentId: praw = "" } = useParams<{ id: string; paymentId: string }>();
  const id = Number(raw), pid = Number(praw);
  const valid = Number.isSafeInteger(id) && id > 0 && Number.isSafeInteger(pid) && pid > 0;
  const { session } = useSessionCsrf();
  const q = useGetAdminOrder(id, { query: { queryKey: getGetAdminOrderQueryKey(id), enabled: valid && !!session.data?.user && !session.data.user.mustChangePassword && session.data.user.role !== "CASHIER" } });
  const p = q.data?.payments.find((x) => x.id === pid);
  return (
    <AdminShell title="Reçu" actions={<div className="flex gap-2 no-print"><Link href={`/admin/commandes/${id}`} className={btnGhost}><ArrowLeft className="w-4 h-4" />Commande</Link>{p && <button className={btnDark} onClick={() => window.print()} data-testid="button-print"><Printer className="w-4 h-4" />Imprimer</button>}</div>}>
      {!valid ? <p>Identifiant invalide.</p> : q.isLoading ? <Skel h="h-96" /> : q.isError || !q.data ? (
        <div className="space-y-3"><ErrorText e={q.error} /><button className={btnGhost} onClick={() => q.refetch()}>Réessayer</button></div>
      ) : !p ? <p data-testid="status-receipt-missing">Paiement introuvable pour cette commande.</p> : <WebReceipt o={q.data} p={p} />}
    </AdminShell>
  );
}

function WebReceipt({ o, p }: { o: AdminCheckoutOrder; p: WebOrderPayment }) {
  const rs = p.receiptSettings;
  const row = "flex justify-between gap-2";
  const refund = p.kind === "REFUND";
  return (
    <>
      <style>{"@media print { @page { size: 80mm auto; margin: 0; } }"}</style>
      <div id="pos-receipt" data-testid="receipt" className="bg-[#fffdfa] text-[#1d1a1b] font-mono mx-auto text-[12px] px-4 py-5 leading-snug border border-border/60 shadow-[0_18px_40px_-24px_rgba(40,35,38,.45)]" style={{ width: "80mm" }}>
        <p className="text-center font-bold tracking-[.2em] text-[1.25em]">SOFIA STORE</p>
        {rs.address && <p className="text-center whitespace-pre-line mt-1">{rs.address}</p>}
        {rs.phone && <p className="text-center">Tél. {rs.phone}</p>}
        <div className="border-t border-dashed border-current my-2" />
        <p className="text-center font-bold uppercase">{refund ? "Reçu de remboursement" : "Reçu d'encaissement"}</p>
        <p className="text-center text-[10px]">Document interne, non fiscal</p>
        <div className="border-t border-dashed border-current my-2" />
        <p className={row}><span>Reçu</span><span data-testid="text-receipt-number">{p.number}</span></p>
        <p className={row}><span>Commande</span><span>{o.reference}</span></p>
        <p className={row}><span>Date</span><span>{fmtDateLong(p.createdAt)}</span></p>
        <p className={row}><span>Opérateur</span><span>n° {p.actorId}</span></p>
        <p className={row}><span>Mode</span><span>{p.method === "CASH" ? `Espèces${p.registerSessionId ? ` · tiroir ${p.registerSessionId}` : ""}` : "Banque"}</span></p>
        {p.reference && <p className={row}><span>Réf.</span><span className="break-all text-end">{p.reference}</span></p>}
        <p className={row}><span>Cliente</span><span className="text-end">{o.customerName}</span></p>
        <div className="border-t border-dashed border-current my-2" />
        {o.items.map((l) => (
          <div key={l.variantId} className="mb-1.5"><p className="font-bold break-words">{l.productName}</p><p className={row}><span>{l.quantity} x {formatDA(l.unitPriceMinor)} · {l.size}/{l.color}</span><span>{formatDA(l.lineTotalMinor)}</span></p></div>
        ))}
        <div className="border-t border-dashed border-current my-2" />
        <p className={row}><span>Marchandise</span><span>{formatDA(o.subtotalMinor)}</span></p>
        <p className={row}><span>Frais livraison/retrait</span><span>{formatDA(o.feeMinor)}</span></p>
        <p className={row}><span>Total brut cliente</span><span>{formatDA(o.totalMinor)}</span></p>
        <div className="border-t border-dashed border-current my-2" />
        {refund ? <>
          <p className={row}><span>Marchandise rendue</span><span>{formatDA(p.amountMinor - p.feeRefundMinor)}</span></p>
          <p className={row}><span>Frais rendus</span><span>{formatDA(p.feeRefundMinor)}</span></p>
          <p className={`${row} font-bold text-[1.15em]`}><span>TOTAL REMBOURSÉ</span><span>{formatDA(p.amountMinor)}</span></p>
        </> : <>
          {p.feeMinor > 0 && <p className={row}><span>Frais retenus transporteur</span><span>-{formatDA(p.feeMinor)}</span></p>}
          <p className={`${row} font-bold text-[1.15em]`}><span>NET REÇU BOUTIQUE</span><span>{formatDA(p.amountMinor)}</span></p>
          {p.tenderedMinor !== null && <><p className={row}><span>Remis</span><span>{formatDA(p.tenderedMinor)}</span></p><p className={row}><span>Rendu</span><span>{formatDA(p.changeMinor)}</span></p></>}
        </>}
        {p.reason && <p className="mt-2 break-words text-[10px]">Motif : {p.reason}</p>}
        {rs.footer && <><div className="border-t border-dashed border-current my-2" /><p className="text-center whitespace-pre-line">{rs.footer}</p></>}
      </div>
    </>
  );
}

