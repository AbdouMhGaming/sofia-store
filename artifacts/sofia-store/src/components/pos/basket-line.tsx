import { useEffect, useState } from "react";
import { Minus, Plus, X } from "lucide-react";
import { formatDA } from "@/lib/util";
import { MAX_QTY, parseMoney, type BasketLine } from "@/lib/pos";
import { imgSrc } from "@/components/admin/media-picker";

export function MoneyInput({ valueMinor, onCommit, disabled, testId, placeholder = "0" }: { valueMinor: number; onCommit: (m: number) => void; disabled?: boolean; testId: string; placeholder?: string }) {
  const toStr = (m: number) => (m ? (m / 100).toFixed(2).replace(".", ",").replace(/,00$/, "") : "");
  const [raw, setRaw] = useState(toStr(valueMinor));
  const [bad, setBad] = useState(false);
  useEffect(() => { setRaw(toStr(valueMinor)); setBad(false); }, [valueMinor]);
  const commit = () => {
    if (!raw.trim()) { setBad(false); return onCommit(0); }
    const v = parseMoney(raw);
    if (v === null) return setBad(true);
    setBad(false); onCommit(v);
  };
  return (
    <input inputMode="decimal" disabled={disabled} value={raw} placeholder={placeholder} onChange={(e) => setRaw(e.target.value)}
      onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }}
      className={`w-24 px-2 py-1 rounded border bg-background font-mono text-xs text-right outline-none focus:border-primary ${bad ? "border-destructive" : "border-input"}`}
      data-testid={testId} />
  );
}

export function BasketLineRow({ line, locked, canManage, onQty, onDiscount, onRemove }: {
  line: BasketLine; locked: boolean; canManage: boolean;
  onQty: (q: number) => void; onDiscount: (m: number) => void; onRemove: () => void;
}) {
  const v = line.variant;
  const gross = v.priceMinor * line.quantity;
  const max = Math.min(v.available, MAX_QTY);
  const over = line.quantity > v.available;
  return (
    <li className="grid grid-cols-[auto_1fr_auto] gap-3 py-3 px-1 rise" data-testid={`row-basket-${v.id}`}>
      <div className="w-11 h-14 rounded-sm bg-muted overflow-hidden">{v.image && <img src={imgSrc(v.image)} alt="" className="w-full h-full object-cover" />}</div>
      <div className="min-w-0">
        <p className="text-sm font-medium truncate">{v.productName}</p>
        <p className="text-xs text-muted-foreground"><span className="inline-block px-1.5 rounded bg-muted text-foreground/80 me-1">{v.size}</span>{v.color} · <span className="font-mono">{v.sku}</span></p>
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <div className="inline-flex items-center rounded-full border border-border">
            <button className="p-1.5 hover:text-primary disabled:opacity-30" disabled={locked || line.quantity <= 1} onClick={() => onQty(line.quantity - 1)} data-testid={`button-dec-${v.id}`} aria-label="Moins"><Minus className="w-3 h-3" /></button>
            <input inputMode="numeric" disabled={locked} value={line.quantity}
              onChange={(e) => { const n = parseInt(e.target.value.replace(/\D/g, "") || "0", 10); if (n >= 1) onQty(Math.min(n, max)); }}
              className="w-9 text-center bg-transparent text-sm font-mono outline-none" data-testid={`input-qty-${v.id}`} />
            <button className="p-1.5 hover:text-primary disabled:opacity-30" disabled={locked || line.quantity >= max} onClick={() => onQty(line.quantity + 1)} data-testid={`button-inc-${v.id}`} aria-label="Plus"><Plus className="w-3 h-3" /></button>
          </div>
          <span className="text-[11px] text-muted-foreground">{v.available} dispo</span>
          {canManage && (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">Remise
              <MoneyInput valueMinor={line.discountMinor} disabled={locked} onCommit={onDiscount} testId={`input-line-discount-${v.id}`} />
            </span>
          )}
        </div>
        {over && <p className="text-[11px] text-destructive mt-1">Quantité supérieure au stock signalé ({v.available}).</p>}
        {line.discountMinor > gross && <p className="text-[11px] text-destructive mt-1">La remise dépasse le montant de la ligne.</p>}
      </div>
      <div className="text-right flex flex-col items-end justify-between">
        <button disabled={locked} onClick={onRemove} className="text-muted-foreground hover:text-destructive disabled:opacity-30" data-testid={`button-remove-${v.id}`} aria-label="Retirer"><X className="w-4 h-4" /></button>
        <div>
          {line.discountMinor > 0 && <p className="text-[11px] text-muted-foreground line-through font-mono">{formatDA(gross)}</p>}
          <p className="font-mono text-sm" data-testid={`text-line-total-${v.id}`}>{formatDA(gross - line.discountMinor)}</p>
          <p className="text-[10px] text-muted-foreground font-mono">{line.quantity} x {formatDA(v.priceMinor)}</p>
        </div>
      </div>
    </li>
  );
}
