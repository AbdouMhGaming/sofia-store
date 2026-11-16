import { useEffect, useRef, useState } from "react";
import { Link, useSearch } from "wouter";
import JsBarcode from "jsbarcode";
import { History, Printer } from "lucide-react";
import {
  useListStockMovements, useUpdateVariant, getListStockMovementsQueryKey, type InventoryRow,
} from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useSessionCsrf } from "@/lib/auth";
import { daToMinor, errMsg, formatDA } from "@/lib/util";
import { AdminShell, ErrorText, Field, Skel, btnDark, btnGhost, inputCls, useInvalidateCatalog } from "@/pages/admin";

const KIND: Record<string, string> = { RECEIPT: "Réception", ADJUSTMENT: "Correction", DAMAGE: "Dommage", RETURN: "Retour", SALE: "Vente", REFUND: "Remboursement", VOID: "Annulation", RESERVATION: "Réservation" };

/* ---------- Movements ---------- */

function MovementChunk({ variantId, before, enabled }: { variantId?: number; before?: number; enabled: boolean }) {
  const params = { ...(variantId ? { variantId } : {}), ...(before ? { before } : {}) };
  const q = useListStockMovements(params, { query: { queryKey: getListStockMovementsQueryKey(params), enabled } });
  const [more, setMore] = useState(false);
  if (q.isLoading) return <Skel h="h-40" />;
  if (q.isError) return <div className="py-4"><ErrorText e={q.error} /><button className={`${btnGhost} mt-3`} onClick={() => q.refetch()}>Réessayer</button></div>;
  const page = q.data!;
  if (!before && page.items.length === 0) return (
    <div className="py-16 text-center" data-testid="status-movements-empty">
      <History className="w-8 h-8 mx-auto text-primary/50" strokeWidth={1.2} />
      <p className="font-serif text-2xl mt-3">Aucun mouvement enregistré.</p>
    </div>
  );
  return (
    <>
      {page.items.map((m) => (
        <div key={m.id} className="grid grid-cols-[auto_1fr_auto] gap-x-4 items-center px-5 py-3.5 border-t border-border first:border-t-0" data-testid={`row-movement-${m.id}`}>
          <span className={`w-14 text-right font-serif text-2xl tabular-nums ${m.quantity > 0 ? "text-primary" : "text-secondary"}`}>{m.quantity > 0 ? `+${m.quantity}` : m.quantity}</span>
          <div className="min-w-0">
            <p className="text-sm truncate"><span className="font-medium">{m.productName}</span> <span className="text-muted-foreground">· {m.size} / {m.color} · <span className="font-mono text-xs">{m.sku}</span></span></p>
            <p className="text-xs text-muted-foreground truncate">{KIND[m.kind] ?? m.kind} · {m.reason} · {m.actor} · {new Date(m.createdAt).toLocaleString("fr-FR")}</p>
          </div>
          <div className="text-right"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Solde</p><p className="tabular-nums font-medium" data-testid={`text-balance-${m.id}`}>{m.balanceAfter}</p></div>
        </div>
      ))}
      {page.nextCursor !== null && (more ? <MovementChunk variantId={variantId} before={page.nextCursor} enabled={enabled} /> : (
        <div className="p-4 border-t border-border text-center"><button className={btnGhost} onClick={() => setMore(true)} data-testid="button-load-more-movements">Afficher plus</button></div>
      ))}
    </>
  );
}

export function AdminMovementsPage() {
  const { session } = useSessionCsrf();
  const enabled = !!session.data?.user && !session.data.user.mustChangePassword;
  const search = useSearch();
  const raw = new URLSearchParams(search).get("variant");
  const variantId = raw && /^\d+$/.test(raw) && Number(raw) > 0 ? Number(raw) : undefined;
  return (
    <AdminShell title="Mouvements" sub={variantId ? `Historique de la déclinaison n° ${variantId}.` : "Journal complet des entrées et sorties de stock."}
      actions={variantId ? <Link href="/admin/mouvements" className={btnGhost} data-testid="link-all-movements">Tous les mouvements</Link> : undefined}>
      <div className="bg-card border border-border rounded-md max-w-4xl" data-testid="list-movements">
        {enabled ? <MovementChunk key={variantId ?? 0} variantId={variantId} enabled={enabled} /> : <div className="p-4"><Skel h="h-60" /></div>}
      </div>
    </AdminShell>
  );
}

/* ---------- Variant edit ---------- */

const toDA = (m: number) => (m % 100 ? (m / 100).toFixed(2).replace(".", ",") : String(m / 100));

export function VariantEditDialog({ row, onClose }: { row: InventoryRow | null; onClose: () => void }) {
  const { request } = useSessionCsrf();
  const update = useUpdateVariant({ request });
  const invalidate = useInvalidateCatalog();
  const [f, setF] = useState({ sku: "", barcode: "", size: "", color: "", price: "", cost: "" });
  const [local, setLocal] = useState("");
  useEffect(() => {
    if (row) setF({ sku: row.sku, barcode: row.barcode, size: row.size, color: row.color, price: toDA(row.priceMinor), cost: toDA(row.costMinor) });
    setLocal(""); update.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const submit = () => {
    setLocal("");
    const priceMinor = daToMinor(f.price); const costMinor = daToMinor(f.cost || "0");
    if (!f.sku.trim() || !f.barcode.trim() || !f.size.trim() || !f.color.trim()) return setLocal("SKU, code-barres, taille et couleur sont obligatoires.");
    if (priceMinor === null || priceMinor < 1 || priceMinor > 100000000) return setLocal("Prix de vente invalide.");
    if (costMinor === null || costMinor > 100000000) return setLocal("Coût invalide.");
    update.mutate({ id: row!.id, data: { sku: f.sku.trim(), barcode: f.barcode.trim(), size: f.size.trim(), color: f.color.trim(), priceMinor, costMinor } },
      { onSuccess: () => { invalidate(); onClose(); } });
  };
  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg" dir="ltr">
        <DialogHeader>
          <DialogTitle className="font-serif text-3xl font-normal">Modifier la déclinaison</DialogTitle>
          <DialogDescription>{row?.productName} · les quantités ne changent pas ici, utilisez un mouvement de stock.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <Field label="SKU"><input className={inputCls} maxLength={80} value={f.sku} onChange={set("sku")} data-testid="input-edit-sku" /></Field>
          <Field label="Code-barres"><input className={inputCls} maxLength={80} value={f.barcode} onChange={set("barcode")} data-testid="input-edit-barcode" /></Field>
          <Field label="Taille"><input className={inputCls} maxLength={30} value={f.size} onChange={set("size")} data-testid="input-edit-size" /></Field>
          <Field label="Couleur"><input className={inputCls} maxLength={60} value={f.color} onChange={set("color")} data-testid="input-edit-color" /></Field>
          <Field label="Prix de vente (DA)"><input inputMode="decimal" className={inputCls} value={f.price} onChange={set("price")} data-testid="input-edit-price" /></Field>
          <Field label="Coût d'achat (DA)"><input inputMode="decimal" className={inputCls} value={f.cost} onChange={set("cost")} data-testid="input-edit-cost" /></Field>
        </div>
        {local && <p className="text-sm text-destructive">{local}</p>}
        <ErrorText e={update.error} />
        <div className="flex justify-end gap-2 pt-2">
          <button className={btnGhost} onClick={onClose}>Annuler</button>
          <button className={btnDark} disabled={update.isPending} onClick={submit} data-testid="button-save-variant-edit">{update.isPending ? "Enregistrement…" : "Enregistrer"}</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Barcode label ---------- */

export function BarcodeLabelDialog({ row, onClose }: { row: InventoryRow | null; onClose: () => void }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [err, setErr] = useState("");
  const [copies, setCopies] = useState(1);
  useEffect(() => {
    setErr(""); setCopies(1);
    if (!row) return;
    const t = setTimeout(() => {
      if (!svgRef.current) return;
      try {
        JsBarcode(svgRef.current, row.barcode, { format: "CODE128", width: 1.6, height: 52, fontSize: 13, margin: 4, background: "transparent", lineColor: "#282326", font: "monospace" });
      } catch (e) { setErr(`Code-barres non encodable en Code128 : ${errMsg(e)}`); }
    }, 0);
    return () => clearTimeout(t);
  }, [row]);
  const print = () => {
    if (!row || !svgRef.current) return;
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
    const label = `<div class="l"><p class="n">${esc(row.productName)}</p><p class="m">${esc(row.size)} / ${esc(row.color)} · ${esc(formatDA(row.priceMinor))}</p>${svgRef.current.outerHTML}</div>`;
    const w = window.open("", "_blank", "width=420,height=600");
    if (!w) return setErr("Fenêtre d'impression bloquée par le navigateur.");
    w.document.write(`<!doctype html><html><head><title>Étiquette ${esc(row.sku)}</title><style>@page{size:auto;margin:6mm}body{font-family:Georgia,serif;margin:0}.l{width:58mm;padding:3mm;text-align:center;page-break-inside:avoid;margin:0 auto 4mm}.n{font-size:12pt;margin:0}.m{font:9pt sans-serif;margin:1mm 0}svg{width:100%;height:auto}</style></head><body>${label.repeat(Math.max(1, Math.min(50, copies)))}</body></html>`);
    w.document.close(); w.focus(); setTimeout(() => w.print(), 200);
  };
  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm" dir="ltr">
        <DialogHeader>
          <DialogTitle className="font-serif text-3xl font-normal">Étiquette</DialogTitle>
          <DialogDescription>Code128 du code-barres attribué.</DialogDescription>
        </DialogHeader>
        <div className="mx-auto w-64 bg-[#fffdfa] border border-border rounded-md p-4 text-center shadow-[0_10px_30px_-18px_rgba(40,35,38,.4)]" data-testid="panel-barcode-label">
          <p className="font-serif text-xl leading-tight">{row?.productName}</p>
          <p className="text-xs text-muted-foreground mt-1">{row?.size} / {row?.color} · {row && formatDA(row.priceMinor)}</p>
          <svg ref={svgRef} className="w-full mt-2" data-testid="img-barcode" />
        </div>
        {err && <p className="text-sm text-destructive">{err}</p>}
        <div className="flex items-end justify-between gap-3">
          <Field label="Copies"><input type="number" min={1} max={50} className={`${inputCls} w-24`} value={copies} onChange={(e) => setCopies(Number(e.target.value) || 1)} data-testid="input-label-copies" /></Field>
          <button className={btnDark} disabled={!!err} onClick={print} data-testid="button-print-label"><Printer className="w-4 h-4" />Imprimer</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
