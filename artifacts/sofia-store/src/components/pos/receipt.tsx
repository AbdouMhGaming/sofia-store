import type { PosSale } from "@workspace/api-client-react";
import { formatDA } from "@/lib/util";
import { fmtDateLong, REFUND_KIND, SALE_STATUS } from "@/lib/pos";

export type PaperWidth = 58 | 80;

/** Immutable receipt rendered strictly from the sale snapshot. Printed area = #pos-receipt only. */
export function Receipt({ sale, width }: { sale: PosSale; width: PaperWidth }) {
  const rs = sale.receiptSettings;
  const small = width === 58;
  const row = "flex justify-between gap-2";
  return (
    <>
      <style>{`@media print { @page { size: ${width}mm auto; margin: 0; } }`}</style>
      <div id="pos-receipt" data-testid="receipt"
        className={`bg-[#fffdfa] text-[#1d1a1b] font-mono mx-auto shadow-[0_18px_40px_-24px_rgba(40,35,38,.45)] border border-border/60 ${small ? "text-[10.5px] px-3" : "text-[12px] px-4"} py-5 leading-snug`}
        style={{ width: `${width}mm` }}>
        <p className="text-center font-bold tracking-[.2em] text-[1.25em]">{sale.storeName || "SOFIA STORE"}</p>
        {rs.address && <p className="text-center whitespace-pre-line mt-1">{rs.address}</p>}
        {rs.phone && <p className="text-center">Tél. {rs.phone}</p>}
        <div className="border-t border-dashed border-current my-2" />
        <p className={row}><span>Ticket</span><span data-testid="text-receipt-number">{sale.number}</span></p>
        <p className={row}><span>Date</span><span>{fmtDateLong(sale.createdAt)}</span></p>
        <p className={row}><span>Caissier</span><span>n° {sale.cashierId}</span></p>
        <p className={row}><span>Tiroir</span><span>session {sale.registerSessionId}</span></p>
        {sale.status !== "COMPLETED" && <p className="text-center font-bold mt-1 uppercase">** {SALE_STATUS[sale.status]?.[0] ?? sale.status} **</p>}
        <div className="border-t border-dashed border-current my-2" />
        {sale.items.map((l) => (
          <div key={l.id} className="mb-1.5">
            <p className="font-bold break-words">{l.productName}</p>
            <p className="opacity-80">{l.size} / {l.color} · {l.sku}</p>
            <p className={row}><span>{l.quantity} x {formatDA(l.unitPriceMinor)}</span><span>{formatDA(l.unitPriceMinor * l.quantity)}</span></p>
            {l.discountMinor > 0 && <p className={row}><span>Remise</span><span>-{formatDA(l.discountMinor)}</span></p>}
            {l.discountMinor > 0 && <p className={row}><span>Total ligne</span><span>{formatDA(l.lineTotalMinor)}</span></p>}
            {l.refundedQuantity > 0 && <p className="italic">Rendu : {l.refundedQuantity} / {l.quantity}</p>}
          </div>
        ))}
        <div className="border-t border-dashed border-current my-2" />
        <p className={row}><span>Sous-total</span><span>{formatDA(sale.subtotalMinor)}</span></p>
        {sale.discountMinor > 0 && <p className={row}><span>Remise ticket</span><span>-{formatDA(sale.discountMinor)}</span></p>}
        {sale.discountReason && <p className="opacity-80 break-words">Motif : {sale.discountReason}</p>}
        <p className={`${row} font-bold text-[1.3em] mt-1`}><span>TOTAL</span><span data-testid="text-receipt-total">{formatDA(sale.totalMinor)}</span></p>
        <p className={row}><span>Espèces reçues</span><span>{formatDA(sale.tenderedMinor)}</span></p>
        <p className={row}><span>Monnaie rendue</span><span>{formatDA(sale.changeMinor)}</span></p>
        {sale.refunds.length > 0 && (
          <>
            <div className="border-t border-dashed border-current my-2" />
            {sale.refunds.map((r) => (
              <div key={r.id} className="mb-1">
                <p className={row}><span>{REFUND_KIND[r.kind] ?? r.kind} {r.number}</span><span>-{formatDA(r.amountMinor)}</span></p>
                <p className="opacity-80">{fmtDateLong(r.createdAt)}</p>
              </div>
            ))}
            <p className={`${row} font-bold`}><span>Total remboursé</span><span>-{formatDA(sale.refundedMinor)}</span></p>
          </>
        )}
        <p className="text-center mt-2">Montants en dinars algériens (DZD)</p>
        {rs.footer && <p className="text-center whitespace-pre-line mt-2">{rs.footer}</p>}
      </div>
    </>
  );
}
