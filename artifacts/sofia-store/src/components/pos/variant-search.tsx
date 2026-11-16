import { useEffect, useState } from "react";
import { Search, Plus } from "lucide-react";
import { useSearchPosVariants, getSearchPosVariantsQueryKey, type PosVariant } from "@workspace/api-client-react";
import { formatDA, errMsg } from "@/lib/util";
import { imgSrc } from "@/components/admin/media-picker";

export function VariantSearch({ enabled, disabled, onPick, inBasket }: { enabled: boolean; disabled: boolean; onPick: (v: PosVariant) => void; inBasket: (id: number) => number }) {
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const params = { q: dq };
  const r = useSearchPosVariants(params, { query: { queryKey: getSearchPosVariantsQueryKey(params), enabled: enabled && dq.length >= 2 } });
  const list = r.data ?? [];
  return (
    <div className="bg-card border border-border rounded-md">
      <label className="relative block border-b border-border">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input type="search" value={q} maxLength={100} onChange={(e) => setQ(e.target.value)} placeholder="Recherche manuelle : nom, SKU, taille, couleur"
          className="w-full pl-10 pr-3 py-2.5 bg-transparent text-sm outline-none" data-testid="input-pos-search" />
      </label>
      <div className="max-h-[340px] overflow-y-auto">
        {dq.length < 2 ? <p className="text-xs text-muted-foreground p-4">Tapez au moins 2 caractères si le code-barres est illisible.</p>
          : r.isLoading ? <div className="p-3 space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-12 bg-muted animate-pulse rounded" />)}</div>
          : r.isError ? <div className="p-4 text-sm text-destructive">{errMsg(r.error)} <button className="underline ms-2" onClick={() => r.refetch()}>Réessayer</button></div>
          : list.length === 0 ? <p className="text-sm text-muted-foreground p-4" data-testid="status-search-empty">Aucune déclinaison ne correspond.</p>
          : (
            <ul className="divide-y divide-border">
              {list.map((v) => {
                const inB = inBasket(v.id);
                const out = v.available <= 0 || inB >= v.available;
                return (
                  <li key={v.id}>
                    <button disabled={disabled || out} onClick={() => onPick(v)} data-testid={`button-pick-${v.id}`}
                      className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-accent/60 transition-colors disabled:opacity-45 disabled:cursor-not-allowed group">
                      <div className="w-8 h-10 rounded-sm bg-muted overflow-hidden shrink-0">{v.image && <img src={imgSrc(v.image)} alt="" className="w-full h-full object-cover" />}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">{v.productName} <span className="text-muted-foreground">· {v.size} / {v.color}</span></p>
                        <p className="text-[11px] text-muted-foreground font-mono truncate">{v.sku} · {v.barcode}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-mono">{formatDA(v.priceMinor)}</p>
                        <p className={`text-[11px] ${v.available <= 0 ? "text-destructive" : "text-muted-foreground"}`}>{v.available <= 0 ? "Rupture" : `${v.available} dispo${inB ? ` · ${inB} au panier` : ""}`}</p>
                      </div>
                      <Plus className="w-4 h-4 text-primary opacity-0 group-hover:opacity-100 transition-opacity" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        {list.length >= 40 && <p className="text-xs text-secondary p-3 border-t border-border" data-testid="status-search-refine">40 résultats affichés au maximum : affinez la recherche.</p>}
      </div>
    </div>
  );
}
