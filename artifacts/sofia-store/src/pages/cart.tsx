import { Link } from "wouter";
import { Minus, Plus, ShoppingBag, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { asset, formatDA } from "@/lib/util";
import { CART_MAX_QTY, useCart, useCommerce, useShopT } from "@/lib/shop";
import { SiteLayout, PageTitle, CallButton } from "@/components/site";

export function CartPage() {
  const { pick } = useI18n();
  const s = useShopT();
  const cart = useCart();
  const { cfg, enabled } = useCommerce();
  const subtotal = cart.lines.reduce((a, l) => a + l.priceMinor * l.quantity, 0);
  return (
    <SiteLayout>
      <PageTitle eyebrow={s("cartEyebrow")} title={s("cart")} />
      <div className="max-w-7xl mx-auto px-5 md:px-10">
        {cart.lines.length === 0 ? (
          <div className="py-20 text-center border border-dashed border-border rounded-sm" data-testid="status-cart-empty">
            <ShoppingBag className="w-8 h-8 mx-auto text-primary/50" strokeWidth={1.2} />
            <p className="font-serif text-3xl mt-4">{s("cartEmpty")}</p>
            <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">{s("cartEmptyText")}</p>
            <Link href="/boutique" className="inline-block mt-6 text-sm text-primary link-underline" data-testid="link-continue">{s("continue")}</Link>
          </div>
        ) : (
          <div className="grid md:grid-cols-[1.6fr_1fr] gap-10 items-start">
            <ul className="divide-y divide-border border-y border-border">
              {cart.lines.map((l) => (
                <li key={l.variantId} className="py-5 flex gap-4 md:gap-6" data-testid={`row-cart-${l.variantId}`}>
                  <Link href={`/produit/${l.slug}`} className="w-20 md:w-24 aspect-[3/4] bg-muted rounded-sm overflow-hidden shrink-0">
                    {l.image && <img src={asset(l.image)} alt="" className="w-full h-full object-cover" />}
                  </Link>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between gap-3">
                      <Link href={`/produit/${l.slug}`} className="font-serif text-xl md:text-2xl leading-tight hover:text-primary">{pick(l.nameFr, l.nameAr)}</Link>
                      <button onClick={() => cart.remove(l.variantId)} aria-label={s("remove")} data-testid={`button-remove-${l.variantId}`}
                        className="p-1.5 h-fit rounded-full hover:bg-accent"><X className="w-4 h-4" /></button>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{l.size} · {l.color}</p>
                    <div className="flex items-end justify-between mt-4 gap-3">
                      <div className="flex items-center border border-border rounded-full">
                        <button className="p-2 disabled:opacity-30" disabled={l.quantity <= 1} onClick={() => cart.setQty(l.variantId, l.quantity - 1)} aria-label="-" data-testid={`button-minus-${l.variantId}`}><Minus className="w-3.5 h-3.5" /></button>
                        <span className="w-8 text-center text-sm tabular-nums" data-testid={`text-qty-${l.variantId}`}>{l.quantity}</span>
                        <button className="p-2 disabled:opacity-30" disabled={l.quantity >= CART_MAX_QTY} onClick={() => cart.setQty(l.variantId, l.quantity + 1)} aria-label="+" data-testid={`button-plus-${l.variantId}`}><Plus className="w-3.5 h-3.5" /></button>
                      </div>
                      <div className="text-end">
                        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{s("unitHint")} {formatDA(l.priceMinor)}</p>
                        <p className="font-serif text-xl tabular-nums">{formatDA(l.priceMinor * l.quantity)}</p>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <aside className="md:sticky md:top-28 bg-[#f7e6ec]/60 border border-primary/10 rounded-sm p-7 space-y-5">
              <div className="flex justify-between items-baseline">
                <span className="text-sm text-muted-foreground">{s("subtotalHint")}</span>
                <span className="font-serif text-3xl tabular-nums" data-testid="text-cart-subtotal">{formatDA(subtotal)}</span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{s("cartNote")}</p>
              {cfg.isLoading || (cfg.isFetching && !enabled) ? <div className="h-12 rounded-full bg-muted animate-pulse" /> : cfg.isError ? (
                <div role="alert" className="text-sm text-destructive">{pick("Impossible de vérifier les options de commande.", "تعذر التحقق من خيارات الطلب.")}<button className="block mt-3 underline" type="button" onClick={() => void cfg.refetch()}>{pick("Réessayer", "إعادة المحاولة")}</button></div>
              ) : enabled ? (
                <Link href="/commande" data-testid="link-checkout"
                  className="flex justify-center items-center px-7 py-3.5 rounded-full bg-[#282326] text-[#f6efe9] text-sm hover:bg-primary transition-colors">{s("toCheckout")}</Link>
              ) : (
                <div className="space-y-3" data-testid="status-commerce-off">
                  <p className="font-serif text-xl">{s("offTitle")}</p>
                  <p className="text-sm text-muted-foreground">{s("offText")}</p>
                  <CallButton label={s("callStore")} className="w-full justify-center" />
                </div>
              )}
              <div className="flex justify-between text-sm pt-2">
                <Link href="/boutique" className="link-underline text-secondary">{s("continue")}</Link>
                <button onClick={() => cart.clear()} className="text-muted-foreground hover:text-destructive" data-testid="button-clear-cart">{s("clear")}</button>
              </div>
            </aside>
          </div>
        )}
      </div>
    </SiteLayout>
  );
}
