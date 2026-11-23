import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Check, Minus, Plus, ShoppingBag } from "lucide-react";
import type { Product } from "@workspace/api-client-react";
import { useI18n } from "@/lib/i18n";
import { formatDA } from "@/lib/util";
import { CART_MAX_QTY, isBuyable, useCart, useCommerce, useShopT } from "@/lib/shop";

/** Exact size/colour selection + add to cart for ACTIVE products; PREVIEW stays enquiry-only. */
export function ProductBuy({ p }: { p: Product }) {
  const { t, pick } = useI18n();
  const s = useShopT();
  const cart = useCart();
  const { enabled, cfg } = useCommerce();
  const sizes = useMemo(() => Array.from(new Set(p.variants.map((v) => v.size))), [p]);
  const colors = useMemo(() => Array.from(new Set(p.variants.map((v) => v.color))), [p]);
  const [size, setSize] = useState(sizes.length === 1 ? sizes[0] : "");
  const [color, setColor] = useState(colors.length === 1 ? colors[0] : "");
  const [qty, setQty] = useState(1);
  const [msg, setMsg] = useState<"" | "added" | "full">("");
  const buyable = isBuyable(p);
  const variant = size && color ? p.variants.find((v) => v.size === size && v.color === color) : undefined;
  const exists = (sz: string, c: string) => p.variants.some((v) => v.size === sz && v.color === c);
  const max = variant ? Math.min(CART_MAX_QTY, variant.available) : 1;

  if (!buyable) {
    return (
      <div className="mt-8 border-t border-border pt-6 space-y-4">
        <p className="eyebrow">{t("variants")}</p>
        {sizes.length > 0 && <div className="flex flex-wrap gap-2 items-center"><span className="text-sm w-20 text-muted-foreground">{t("size")}</span>{sizes.map((x) => <span key={x} className="px-3 py-1 border border-border rounded-full text-sm">{x}</span>)}</div>}
        {colors.length > 0 && <div className="flex flex-wrap gap-2 items-center"><span className="text-sm w-20 text-muted-foreground">{t("color")}</span>{colors.map((x) => <span key={x} className="px-3 py-1 border border-border rounded-full text-sm">{x}</span>)}</div>}
        {p.status === "PREVIEW" && <p className="text-sm text-secondary" data-testid="text-preview-only">{s("previewOnly")}</p>}
      </div>
    );
  }

  const chip = (on: boolean, dim: boolean) =>
    `px-4 py-2 rounded-full text-sm border transition-all ${on ? "bg-[#282326] text-[#f6efe9] border-[#282326]" : dim ? "border-dashed border-border text-muted-foreground/60" : "border-border hover:border-primary hover:text-primary"}`;

  return (
    <div className="mt-8 border-t border-border pt-6 space-y-5" data-testid="panel-buy">
      <div>
        <p className="text-sm text-muted-foreground mb-2">{t("size")}</p>
        <div className="flex flex-wrap gap-2">
          {sizes.map((x) => (
            <button key={x} onClick={() => { setSize(x); setQty(1); setMsg(""); }} className={chip(size === x, !!color && !exists(x, color))} data-testid={`button-size-${x}`}>{x}</button>
          ))}
        </div>
      </div>
      <div>
        <p className="text-sm text-muted-foreground mb-2">{t("color")}</p>
        <div className="flex flex-wrap gap-2">
          {colors.map((x) => (
            <button key={x} onClick={() => { setColor(x); setQty(1); setMsg(""); }} className={chip(color === x, !!size && !exists(size, x))} data-testid={`button-color-${x}`}>{x}</button>
          ))}
        </div>
      </div>
      <div className="min-h-[3.5rem] flex items-end justify-between gap-4 border-t border-dashed border-border pt-4" aria-live="polite">
        {!size || !color ? <p className="text-sm text-muted-foreground">{s("chooseVariant")}</p>
          : !variant ? <p className="text-sm text-destructive">{s("unavailableCombo")}</p>
          : (
            <>
              <div>
                <p className="font-serif text-4xl" data-testid="text-variant-price">{formatDA(variant.priceMinor)}</p>
                <p className={`text-xs mt-1 ${variant.available > 0 ? "text-secondary" : "text-destructive"}`} data-testid="text-variant-stock">
                  {variant.available > 0 ? `${variant.available} ${s("inStock")}` : s("outStock")}
                </p>
              </div>
              {variant.available > 0 && enabled && (
                <div className="flex items-center border border-border rounded-full">
                  <button className="p-2.5 disabled:opacity-30" disabled={qty <= 1} onClick={() => setQty(qty - 1)} aria-label="-" data-testid="button-qty-minus"><Minus className="w-3.5 h-3.5" /></button>
                  <span className="w-8 text-center text-sm tabular-nums" data-testid="text-qty">{qty}</span>
                  <button className="p-2.5 disabled:opacity-30" disabled={qty >= max} onClick={() => setQty(qty + 1)} aria-label="+" data-testid="button-qty-plus"><Plus className="w-3.5 h-3.5" /></button>
                </div>
              )}
            </>
          )}
      </div>
      {cfg.isPending || (cfg.isFetching && !enabled) ? <p role="status" className="text-sm text-muted-foreground" data-testid="status-commerce-loading">{pick("Vérification de la commande en ligne…", "جارٍ التحقق من إتاحة الطلب…")}</p>
      : cfg.isError ? <div role="alert" className="text-sm text-destructive"><p>{pick("Impossible de vérifier la commande en ligne.", "تعذر التحقق من إتاحة الطلب.")}</p><button type="button" className="link-underline mt-2" onClick={() => void cfg.refetch()}>{pick("Réessayer", "إعادة المحاولة")}</button></div>
      : enabled ? (
        <div className="space-y-2">
          <button disabled={!variant || variant.available <= 0}
            onClick={() => { if (variant) setMsg(cart.add(p, variant, qty) ? "added" : "full"); }}
            data-testid="button-add-cart"
            className="w-full inline-flex items-center justify-center gap-3 px-7 py-3.5 rounded-full bg-[#282326] text-[#f6efe9] text-sm hover:bg-primary transition-colors disabled:opacity-40 disabled:pointer-events-none">
            <ShoppingBag className="w-4 h-4" strokeWidth={1.5} />{s("addToCart")}
          </button>
          {msg === "added" && (
            <p className="text-sm flex items-center justify-between gap-2 text-secondary rise" data-testid="status-added">
              <span className="inline-flex items-center gap-2"><Check className="w-4 h-4" />{s("added")}</span>
              <Link href="/panier" className="link-underline text-primary" data-testid="link-view-cart">{s("viewCart")}</Link>
            </p>
          )}
          {msg === "full" && <p className="text-sm text-destructive">{s("cartFull")}</p>}
        </div>
      ) : <p className="text-sm text-muted-foreground" data-testid="text-commerce-off">{s("offTitle")}</p>}
    </div>
  );
}
