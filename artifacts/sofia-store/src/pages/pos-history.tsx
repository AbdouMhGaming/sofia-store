import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Search, ReceiptText, ChevronRight } from "lucide-react";
import { useListPosSales, getListPosSalesQueryKey } from "@workspace/api-client-react";
import { AdminShell } from "@/pages/admin";
import { btnGhost, ErrorText } from "@/components/admin/shell-primitives";
import { PosTabs } from "@/components/pos/pos-tabs";
import { usePos, fmtDate, SALE_STATUS } from "@/lib/pos";
import { formatDA } from "@/lib/util";

export function PosHistoryPage() {
  const { enabled } = usePos();
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [cursors, setCursors] = useState<(number | undefined)[]>([undefined]);
  useEffect(() => { const t = setTimeout(() => { setDq(q.trim()); setCursors([undefined]); }, 300); return () => clearTimeout(t); }, [q]);
  return (
    <AdminShell title="Tickets" sub="Historique des ventes enregistrées, heure d'Alger.">
      <PosTabs />
      <label className="relative block max-w-md mb-5">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input type="search" maxLength={100} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Numéro de ticket, SKU, article…"
          className="w-full pl-10 pr-3 py-2.5 rounded-full bg-card border border-input text-sm outline-none focus:border-primary" data-testid="input-sales-search" />
      </label>
      <div className="bg-card border border-border rounded-md overflow-hidden">
        <div className="hidden md:grid grid-cols-[1.2fr_1.2fr_.8fr_1fr_1fr_24px] gap-3 px-4 py-2 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border bg-muted/40">
          <span>Ticket</span><span>Date</span><span>Articles</span><span>Statut</span><span className="text-right">Total</span><span />
        </div>
        {cursors.map((c, i) => (
          <SalesPage key={`${dq}-${c ?? "first"}`} enabled={enabled} q={dq} before={c} last={i === cursors.length - 1}
            onMore={(n) => setCursors((cs) => [...cs, n])} />
        ))}
      </div>
    </AdminShell>
  );
}

function SalesPage({ enabled, q, before, last, onMore }: { enabled: boolean; q: string; before?: number; last: boolean; onMore: (n: number) => void }) {
  const params = { ...(q ? { q } : {}), ...(before ? { before } : {}) };
  const r = useListPosSales(params, { query: { queryKey: getListPosSalesQueryKey(params), enabled } });
  if (r.isLoading || !enabled) return <div className="p-4 space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-10 bg-muted animate-pulse rounded" />)}</div>;
  if (r.isError) return <div className="p-4"><ErrorText e={r.error} /><button className={`${btnGhost} mt-2`} onClick={() => r.refetch()}>Réessayer</button></div>;
  const items = r.data?.items ?? [];
  if (!before && items.length === 0) return (
    <div className="py-16 text-center" data-testid="status-sales-empty">
      <ReceiptText className="w-8 h-8 mx-auto text-primary/50" strokeWidth={1.2} />
      <p className="font-serif text-2xl mt-3">{q ? "Aucun ticket trouvé." : "Aucune vente pour l'instant."}</p>
    </div>
  );
  return (
    <>
      {items.map((s) => {
        const units = s.items.reduce((a, l) => a + l.quantity, 0);
        return (
          <Link key={s.id} href={`/pos/tickets/${s.id}`} data-testid={`row-sale-${s.id}`}
            className="grid grid-cols-2 md:grid-cols-[1.2fr_1.2fr_.8fr_1fr_1fr_24px] gap-x-3 gap-y-1 px-4 py-3 border-b border-border text-sm items-center hover:bg-accent/40 transition-colors group">
            <span className="font-mono">{s.number}</span>
            <span className="text-muted-foreground text-right md:text-left">{fmtDate(s.createdAt)}</span>
            <span className="text-muted-foreground">{units} art. · caissier n° {s.cashierId}</span>
            <span className="text-right md:text-left"><span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full ${SALE_STATUS[s.status]?.[1]}`}>{SALE_STATUS[s.status]?.[0] ?? s.status}</span></span>
            <span className="font-mono md:text-right col-span-2 md:col-span-1">{formatDA(s.totalMinor)}{s.refundedMinor > 0 && <span className="text-destructive text-xs ms-2">-{formatDA(s.refundedMinor)}</span>}</span>
            <ChevronRight className="hidden md:block w-4 h-4 text-muted-foreground group-hover:translate-x-0.5 group-hover:text-primary transition" />
          </Link>
        );
      })}
      {last && r.data?.nextCursor != null && (
        <div className="p-3 text-center"><button className={btnGhost} onClick={() => onMore(r.data!.nextCursor!)} data-testid="button-sales-more">Tickets plus anciens</button></div>
      )}
    </>
  );
}
