import { useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Heart, Menu, Phone, X, Instagram, Facebook, Music2 } from "lucide-react";
import { useGetStore, getGetStoreQueryKey, type Product } from "@workspace/api-client-react";
import { useI18n } from "@/lib/i18n";
import { asset, telHref, useFavorites } from "@/lib/util";

export const FALLBACK_PHONE = "0792 01 34 53";

export function useStoreInfo() {
  return useGetStore({ query: { queryKey: getGetStoreQueryKey(), staleTime: 300_000 } });
}

export function Logo({ className = "h-14" }: { className?: string }) {
  return <img src={asset("/brand/sofia-logo.png")} alt="SOFIA STORE" className={`${className} w-auto object-contain mix-blend-multiply`} data-testid="img-logo" />;
}

export function SiteLayout({ children }: { children: ReactNode }) {
  const { t, lang, setLang } = useI18n();
  const [loc] = useLocation();
  const [open, setOpen] = useState(false);
  const { ids } = useFavorites();
  const store = useStoreInfo().data;
  const phone = store?.phone || FALLBACK_PHONE;
  const nav = [
    { href: "/", label: t("home") },
    { href: "/boutique", label: t("shop") },
    { href: "/a-propos", label: t("about") },
    { href: "/contact", label: t("contact") },
  ];
  const active = (h: string) => (h === "/" ? loc === "/" : loc.startsWith(h));
  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      <div className="bg-[#282326] text-[#f6efe9] text-[11px] tracking-[0.2em] uppercase text-center py-2 px-4">
        <span className="opacity-80">{t("toConfirm")}</span>
        <span className="mx-3 opacity-40">|</span>
        <a href={telHref(phone)} className="hover:text-primary transition-colors" data-testid="link-topbar-phone" dir="ltr">{phone}</a>
      </div>
      <header className="sticky top-0 z-40 bg-background/90 backdrop-blur-md border-b border-border/70">
        <div className="max-w-7xl mx-auto px-5 md:px-10 h-20 flex items-center justify-between gap-6">
          <Link href="/" data-testid="link-home-logo" className="shrink-0"><Logo className="h-14" /></Link>
          <nav className="hidden md:flex items-center gap-9">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} data-testid={`link-nav-${n.href.replace("/", "") || "home"}`}
                className={`text-[13px] tracking-[0.14em] uppercase link-underline pb-1 transition-colors ${active(n.href) ? "text-primary" : "text-foreground/80 hover:text-foreground"}`}>
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <button onClick={() => setLang(lang === "fr" ? "ar" : "fr")} data-testid="button-lang"
              className="text-[13px] px-3 py-1.5 rounded-full border border-border hover:border-secondary hover:text-secondary transition-colors">
              {t("switchLang")}
            </button>
            <Link href="/favoris" data-testid="link-favorites" aria-label={t("favorites")}
              className="relative p-2.5 rounded-full hover:bg-accent transition-colors">
              <Heart className="w-[18px] h-[18px]" strokeWidth={1.5} />
              {ids.length > 0 && <span className="absolute top-1 end-1 min-w-4 h-4 px-1 rounded-full bg-primary text-[10px] text-primary-foreground grid place-items-center">{ids.length}</span>}
            </Link>
            <button className="md:hidden p-2.5" onClick={() => setOpen(!open)} data-testid="button-menu" aria-label="menu">
              {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
        {open && (
          <nav className="md:hidden border-t border-border px-5 py-4 flex flex-col gap-3 bg-background">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} onClick={() => setOpen(false)} className="font-serif text-2xl py-1">{n.label}</Link>
            ))}
          </nav>
        )}
      </header>
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}

function Footer() {
  const { t } = useI18n();
  const store = useStoreInfo().data;
  const phone = store?.phone || FALLBACK_PHONE;
  return (
    <footer className="mt-24 bg-[#282326] text-[#efe6df]">
      <div className="max-w-7xl mx-auto px-5 md:px-10 py-16 grid gap-12 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <div className="inline-block bg-[#fbf7f3] rounded-sm p-3"><Logo className="h-16" /></div>
          <p className="mt-5 font-serif text-2xl italic text-[#f3d6e2] max-w-xs">{t("footer")}</p>
        </div>
        <div className="space-y-3 text-sm">
          <p className="eyebrow !text-[#d98c62]">{t("contact")}</p>
          <a href={telHref(phone)} className="block text-xl font-serif hover:text-primary transition-colors" dir="ltr" data-testid="link-footer-phone">{phone}</a>
          {store?.location && <p className="opacity-70">{store.location}</p>}
          <Socials className="pt-2" />
        </div>
        <div className="space-y-2 text-sm">
          <p className="eyebrow !text-[#d98c62]">SOFIA</p>
          <Link href="/boutique" className="block opacity-80 hover:opacity-100">{t("shop")}</Link>
          <Link href="/a-propos" className="block opacity-80 hover:opacity-100">{t("about")}</Link>
          <Link href="/favoris" className="block opacity-80 hover:opacity-100">{t("favorites")}</Link>
          <Link href="/admin" className="block opacity-50 hover:opacity-100 pt-3" data-testid="link-staff">{t("staff")}</Link>
        </div>
      </div>
      <div className="border-t border-white/10 text-center text-[11px] tracking-[0.2em] uppercase py-5 opacity-50">SOFIA STORE · Relizane</div>
    </footer>
  );
}

export function Socials({ className = "", tone = "light" }: { className?: string; tone?: "light" | "dark" }) {
  const store = useStoreInfo().data;
  if (!store) return null;
  const items = [
    { href: store.instagram, icon: Instagram, label: "Instagram" },
    { href: store.facebook, icon: Facebook, label: "Facebook" },
    { href: store.tiktok, icon: Music2, label: "TikTok" },
  ].filter((s) => s.href);
  const cls = tone === "light" ? "border-white/20 hover:bg-primary hover:border-primary" : "border-border hover:bg-primary hover:text-primary-foreground hover:border-primary";
  return (
    <div className={`flex gap-2 ${className}`}>
      {items.map((s) => (
        <a key={s.label} href={s.href} target="_blank" rel="noreferrer" aria-label={s.label} data-testid={`link-social-${s.label.toLowerCase()}`}
          className={`w-10 h-10 rounded-full border grid place-items-center transition-all hover:-translate-y-0.5 ${cls}`}>
          <s.icon className="w-4 h-4" strokeWidth={1.5} />
        </a>
      ))}
    </div>
  );
}

export function ProductCard({ p, index = 0 }: { p: Product; index?: number }) {
  const { pick, t } = useI18n();
  const fav = useFavorites();
  const isFav = fav.has(p.id);
  const img = p.images[0];
  return (
    <div className="group rise" style={{ animationDelay: `${index * 70}ms` }} data-testid={`card-product-${p.id}`}>
      <div className="relative overflow-hidden bg-muted aspect-[3/4] rounded-sm">
        <Link href={`/produit/${p.slug}`} className="block w-full h-full">
          {img ? (
            <img src={asset(img)} alt={pick(p.nameFr, p.nameAr)} loading="lazy"
              className="w-full h-full object-cover transition-transform duration-[1.2s] ease-out group-hover:scale-[1.04]" />
          ) : <div className="w-full h-full grid place-items-center font-serif text-3xl text-primary/40">Sofia</div>}
        </Link>
        <button onClick={() => fav.toggle(p.id)} aria-label={isFav ? t("removeFav") : t("addFav")} data-testid={`button-fav-${p.id}`}
          className="absolute top-3 end-3 w-9 h-9 rounded-full bg-background/85 backdrop-blur grid place-items-center transition-transform hover:scale-110">
          <Heart className={`w-4 h-4 ${isFav ? "fill-primary text-primary" : ""}`} strokeWidth={1.5} />
        </button>
        <span className="absolute bottom-3 start-3 text-[10px] tracking-[0.18em] uppercase bg-background/85 backdrop-blur px-2.5 py-1 rounded-full">
          {pick(p.category.nameFr, p.category.nameAr)}
        </span>
      </div>
      <Link href={`/produit/${p.slug}`} className="block pt-4">
        <h3 className="font-serif text-xl leading-tight group-hover:text-primary transition-colors">{pick(p.nameFr, p.nameAr)}</h3>
        <p className="text-xs text-secondary mt-1.5">{t("toConfirm")}</p>
      </Link>
    </div>
  );
}

export function GridSkeleton({ n = 6 }: { n?: number }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-5 gap-y-10 md:gap-x-8">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i}>
          <div className="aspect-[3/4] bg-muted animate-pulse rounded-sm" />
          <div className="h-5 w-2/3 bg-muted animate-pulse mt-4" />
          <div className="h-3 w-1/2 bg-muted animate-pulse mt-2" />
        </div>
      ))}
    </div>
  );
}

export function ErrorBlock({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div className="border border-destructive/30 bg-destructive/5 rounded-sm p-8 text-center" data-testid="status-error">
      <p className="font-serif text-2xl">{t("loadError")}</p>
      <p className="text-sm text-muted-foreground mt-2">{error instanceof Error ? error.message : String(error)}</p>
      <button onClick={onRetry} className="mt-5 px-5 py-2 rounded-full bg-[#282326] text-[#f6efe9] text-sm hover:bg-primary transition-colors" data-testid="button-retry">{t("retry")}</button>
    </div>
  );
}

export function PageTitle({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <section className="max-w-7xl mx-auto px-5 md:px-10 pt-16 md:pt-24 pb-10">
      <p className="eyebrow rise">{eyebrow}</p>
      <h1 className="font-serif text-5xl md:text-7xl leading-[0.95] mt-4 max-w-4xl rise" style={{ animationDelay: "80ms" }}>{title}</h1>
      {children}
    </section>
  );
}

export function CallButton({ label, className = "" }: { label: string; className?: string }) {
  const store = useStoreInfo().data;
  const phone = store?.phone || FALLBACK_PHONE;
  return (
    <a href={telHref(phone)} data-testid="button-call"
      className={`inline-flex items-center gap-3 px-7 py-3.5 rounded-full bg-primary text-primary-foreground text-sm tracking-wide hover:bg-[#282326] transition-colors ${className}`}>
      <Phone className="w-4 h-4" strokeWidth={1.5} />
      <span>{label}</span>
      <span dir="ltr" className="opacity-80">{phone}</span>
    </a>
  );
}
