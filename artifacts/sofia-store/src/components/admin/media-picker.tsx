import { useState } from "react";
import { ArrowDown, ArrowUp, ImagePlus, RefreshCw, Replace, X } from "lucide-react";
import { useListMedia, getListMediaQueryKey } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { PRODUCT_IMAGES, asset, errMsg } from "@/lib/util";

/** Resolves a stored image path to a displayable URL. API media paths are absolute to the API, supplied photos live under the app base. */
export function imgSrc(p: string) {
  return p.startsWith("/api/") ? p : asset(p);
}
/** Thumbnail URL for a canonical media path. */
export function thumbOf(p: string) {
  return p.startsWith("/api/") ? p.replace(/\/image$/, "/thumbnail") : asset(p);
}

const ghost = "inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full border border-border text-xs hover:border-primary hover:text-primary transition-colors disabled:opacity-40 disabled:pointer-events-none";

/** Ordered image editor for a product: index 0 is the primary photo. */
export function ImagesEditor({ images, onChange }: { images: string[]; onChange: (next: string[]) => void }) {
  const [picker, setPicker] = useState<{ mode: "add" } | { mode: "replace"; index: number } | null>(null);
  const move = (i: number, d: -1 | 1) => {
    const n = [...images]; const j = i + d;
    if (j < 0 || j >= n.length) return;
    [n[i], n[j]] = [n[j], n[i]]; onChange(n);
  };
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs tracking-wide uppercase text-muted-foreground">Images ({images.length}/12) · la première est la photo principale</p>
        <button type="button" className={ghost} disabled={images.length >= 12} onClick={() => setPicker({ mode: "add" })} data-testid="button-add-image"><ImagePlus className="w-3.5 h-3.5" />Ajouter</button>
      </div>
      {images.length === 0 ? (
        <button type="button" onClick={() => setPicker({ mode: "add" })} className="w-full border border-dashed border-border rounded-md py-8 text-sm text-muted-foreground hover:border-primary hover:text-primary transition" data-testid="button-empty-images">
          Aucune image. Choisir dans la médiathèque ou les photos fournies.
        </button>
      ) : (
        <ol className="space-y-2">
          {images.map((src, i) => (
            <li key={src + i} className="flex items-center gap-3 p-2 rounded-md border border-border bg-background" data-testid={`row-image-${i}`}>
              <span className="w-6 text-center font-serif text-lg text-muted-foreground">{i + 1}</span>
              <img src={thumbOf(src)} alt="" className="w-11 h-14 object-cover rounded-sm bg-muted" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-mono truncate">{src}</p>
                {i === 0 && <span className="text-[10px] uppercase tracking-wider text-primary">Principale</span>}
              </div>
              <button type="button" className={ghost} disabled={i === 0} onClick={() => move(i, -1)} aria-label="Monter" data-testid={`button-image-up-${i}`}><ArrowUp className="w-3.5 h-3.5" /></button>
              <button type="button" className={ghost} disabled={i === images.length - 1} onClick={() => move(i, 1)} aria-label="Descendre" data-testid={`button-image-down-${i}`}><ArrowDown className="w-3.5 h-3.5" /></button>
              <button type="button" className={ghost} onClick={() => setPicker({ mode: "replace", index: i })} aria-label="Remplacer" data-testid={`button-image-replace-${i}`}><Replace className="w-3.5 h-3.5" /></button>
              <button type="button" className={ghost} onClick={() => onChange(images.filter((_, k) => k !== i))} aria-label="Retirer" data-testid={`button-image-remove-${i}`}><X className="w-3.5 h-3.5" /></button>
            </li>
          ))}
        </ol>
      )}
      <MediaPickerDialog open={!!picker} exclude={images} onClose={() => setPicker(null)}
        onPick={(p) => {
          if (!picker) return;
          if (picker.mode === "add") onChange([...images, p]);
          else onChange(images.map((x, k) => (k === picker.index ? p : x)));
          setPicker(null);
        }} />
    </div>
  );
}

function MediaPickerDialog({ open, exclude, onClose, onPick }: { open: boolean; exclude: string[]; onClose: () => void; onPick: (p: string) => void }) {
  const media = useListMedia({ query: { queryKey: getListMediaQueryKey(), enabled: open } });
  const [tab, setTab] = useState<"library" | "supplied">("library");
  const tile = (src: string, thumb: string, label: string, id: string) => {
    const used = exclude.includes(src);
    return (
      <button type="button" key={src} disabled={used} onClick={() => onPick(src)} data-testid={`button-pick-${id}`} title={label}
        className={`relative aspect-[3/4] rounded-sm overflow-hidden border-2 transition-all ${used ? "border-primary/40 opacity-40" : "border-transparent hover:border-primary"}`}>
        <img src={thumb} alt={label} className="w-full h-full object-cover bg-muted" loading="lazy" />
        {used && <span className="absolute inset-x-0 bottom-0 bg-[#282326]/80 text-[#f6efe9] text-[10px] py-0.5">Déjà utilisée</span>}
      </button>
    );
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85dvh] overflow-y-auto" dir="ltr">
        <DialogHeader>
          <DialogTitle className="font-serif text-3xl font-normal">Choisir une image</DialogTitle>
          <DialogDescription>Téléversez de nouvelles photos depuis la page Médiathèque.</DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          {(["library", "supplied"] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} data-testid={`tab-picker-${t}`}
              className={`px-3.5 py-1.5 rounded-full text-xs border transition ${tab === t ? "bg-[#282326] text-[#f6efe9] border-[#282326]" : "border-border hover:border-primary"}`}>
              {t === "library" ? "Médiathèque" : "Photos fournies"}
            </button>
          ))}
        </div>
        {tab === "supplied" ? (
          <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">{PRODUCT_IMAGES.map((s) => tile(s, asset(s), s.split("/").pop()!, s.split("/").pop()!))}</div>
        ) : media.isLoading ? (
          <div className="grid grid-cols-6 gap-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="aspect-[3/4] bg-muted animate-pulse rounded-sm" />)}</div>
        ) : media.isError ? (
          <div className="space-y-2"><p className="text-sm text-destructive">{errMsg(media.error)}</p><button type="button" className={ghost} onClick={() => media.refetch()}><RefreshCw className="w-3.5 h-3.5" />Réessayer</button></div>
        ) : !media.data?.enabled ? (
          <p className="text-sm rounded-md border border-secondary/40 bg-[#fbf1ea] p-3" data-testid="status-picker-disabled">Le stockage des médias n'est pas disponible pour le moment. Utilisez les photos fournies.</p>
        ) : media.data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center" data-testid="status-picker-empty">La médiathèque est vide.</p>
        ) : (
          <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">{media.data.items.map((m) => tile(m.path, thumbOf(m.path), m.name, m.id))}</div>
        )}
      </DialogContent>
    </Dialog>
  );
}
