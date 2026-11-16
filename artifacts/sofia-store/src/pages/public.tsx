import { useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import { ArrowLeft, ArrowRight, Heart, MapPin, Phone, Search } from "lucide-react";
import {
  useListCategories, useListProducts, useGetProduct,
  getListCategoriesQueryKey, getListProductsQueryKey, getGetProductQueryKey,
} from "@workspace/api-client-react";
import { useI18n } from "@/lib/i18n";
import { asset, telHref, useFavorites } from "@/lib/util";
import {
  SiteLayout, ProductCard, GridSkeleton, ErrorBlock, PageTitle, CallButton, Socials, useStoreInfo, FALLBACK_PHONE,
} from "@/components/site";

export function HomePage() {
  const { t, lang } = useI18n();
  const products = useListProducts(undefined, { query: { queryKey: getListProductsQueryKey() } });
  const list = products.data ?? [];
  const featured = (list.filter((p) => p.featured).length >= 3 ? list.filter((p) => p.featured) : list).slice(0, 6);
  const Arrow = lang === "ar" ? ArrowLeft : ArrowRight;
  return (
    <SiteLayout>
      <section className="max-w-[1500px] mx-auto px-3 md:px-6 pt-4 md:pt-6">
        <img src={asset("/brand/sofia-hero.png")} alt="SOFIA STORE" className="w-full h-auto block rounded-sm rise" data-testid="img-hero" />
      </section>

      <section className="max-w-7xl mx-auto px-5 md:px-10 py-20 md:py-28 grid md:grid-cols-[1.2fr_1fr] gap-12 items-end">
        <div>
          <p className="eyebrow">{t("heroEyebrow")}</p>
          <h1 className="font-serif text-5xl md:text-7xl leading-[0.95] mt-5">{t("heroTitle")}</h1>
        </div>
        <div>
          <p className="text-muted-foreground leading-relaxed">{t("heroText")}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/boutique" data-testid="button-discover"
              className="group inline-flex items-center gap-3 px-7 py-3.5 rounded-full bg-[#282326] text-[#f6efe9] text-sm hover:bg-primary transition-colors">
              {t("discover")} <Arrow className="w-4 h-4 transition-transform group-hover:translate-x-1 rtl:group-hover:-translate-x-1" />
            </Link>
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-5 md:px-10">
        <div className="flex items-end justify-between gap-6 border-t border-border pt-10 mb-10">
          <div>
            <p className="eyebrow">{t("previewNote")}</p>
            <h2 className="font-serif text-4xl md:text-5xl mt-3">{t("featured")}</h2>
            <p className="text-muted-foreground mt-2 text-sm">{t("featuredText")}</p>
          </div>
          <Link href="/boutique" className="hidden md:inline text-sm link-underline text-secondary" data-testid="link-view-all">{t("viewAll")}</Link>
        </div>
        {products.isLoading ? <GridSkeleton /> : products.isError ? (
          <ErrorBlock error={products.error} onRetry={() => products.refetch()} />
        ) : featured.length === 0 ? (
          <p className="text-muted-foreground py-10 text-center font-serif text-2xl">{t("noResults")}</p>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-5 gap-y-12 md:gap-x-8">
            {featured.map((p, i) => <ProductCard key={p.id} p={p} index={i} />)}
          </div>
        )}
      </section>

      <section className="mt-28 bg-[#f7e6ec]/60 border-y border-primary/10">
        <div className="max-w-7xl mx-auto px-5 md:px-10 py-20 grid md:grid-cols-[1fr_1.3fr] gap-14">
          <div>
            <p className="eyebrow">SOFIA STORE</p>
            <h2 className="font-serif text-4xl md:text-5xl mt-4 leading-tight">{t("phaseTitle")}</h2>
            <p className="text-muted-foreground mt-5 leading-relaxed">{t("phaseText")}</p>
            <CallButton label={t("callUs")} className="mt-8" />
          </div>
          <ol className="grid gap-px bg-primary/15 self-start">
            {(["1", "2", "3"] as const).map((n) => (
              <li key={n} className="bg-[#fbf3f5] p-7 flex gap-6 items-baseline group hover:bg-background transition-colors">
                <span className="font-serif italic text-5xl text-secondary/80 w-10">{n}</span>
                <div>
                  <p className="font-serif text-2xl group-hover:text-primary transition-colors">{t(`p${n}t`)}</p>
                  <p className="text-sm text-muted-foreground mt-1">{t(`p${n}`)}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {list.length > 1 && (
        <section className="max-w-7xl mx-auto px-5 md:px-10 mt-24 grid md:grid-cols-2 gap-6">
          {list.slice(0, 2).map((p, i) => (
            <Link key={p.id} href={`/produit/${p.slug}`} className="group relative overflow-hidden rounded-sm aspect-[4/5] md:aspect-[5/6] bg-muted">
              {p.images[0] && <img src={asset(p.images[0])} alt="" className="w-full h-full object-cover transition-transform duration-[1.4s] group-hover:scale-[1.03]" />}
              <div className="absolute inset-x-0 bottom-0 p-7 bg-gradient-to-t from-[#282326]/75 to-transparent text-[#f6efe9]">
                <p className="text-[11px] tracking-[0.25em] uppercase opacity-80">0{i + 1}</p>
                <p className="font-serif text-3xl mt-1">{lang === "ar" && p.nameAr ? p.nameAr : p.nameFr}</p>
              </div>
            </Link>
          ))}
        </section>
      )}

      <section className="max-w-3xl mx-auto px-5 text-center mt-28">
        <p className="font-serif italic text-3xl md:text-4xl leading-snug text-foreground/85">{t("contactText")}</p>
        <Socials tone="dark" className="justify-center mt-8" />
      </section>
    </SiteLayout>
  );
}

export function ShopPage() {
  const { t, pick } = useI18n();
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState<string>("");
  const params = useMemo(() => {
    const p: { search?: string; category?: string } = {};
    if (search.trim()) p.search = search.trim().slice(0, 100);
    if (cat) p.category = cat;
    return p;
  }, [search, cat]);
  const cats = useListCategories({ query: { queryKey: getListCategoriesQueryKey() } });
  const products = useListProducts(params, { query: { queryKey: getListProductsQueryKey(params), placeholderData: (prev) => prev } });
  return (
    <SiteLayout>
      <PageTitle eyebrow={t("previewNote")} title={t("shop")}>
        <p className="mt-4 text-secondary text-sm">{t("toConfirm")}</p>
      </PageTitle>
      <div className="max-w-7xl mx-auto px-5 md:px-10">
        <div className="sticky top-20 z-30 bg-background/90 backdrop-blur py-4 border-y border-border flex flex-col md:flex-row gap-4 md:items-center justify-between">
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            {[{ slug: "", nameFr: t("all"), nameAr: t("all"), id: 0 }, ...(cats.data ?? [])].map((c) => (
              <button key={c.slug || "all"} onClick={() => setCat(c.slug)} data-testid={`button-category-${c.slug || "all"}`}
                className={`shrink-0 px-4 py-2 rounded-full text-sm border transition-all ${cat === c.slug ? "bg-[#282326] text-[#f6efe9] border-[#282326]" : "border-border hover:border-primary hover:text-primary"}`}>
                {pick(c.nameFr, c.nameAr)}
              </button>
            ))}
          </div>
          <label className="relative md:w-72">
            <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("search")} data-testid="input-search"
              className="w-full ps-9 pe-3 py-2.5 rounded-full bg-card border border-border text-sm outline-none focus:border-primary transition-colors" />
          </label>
        </div>
        <p className="text-xs text-muted-foreground mt-6 mb-8" data-testid="text-count">{products.data?.length ?? 0} {t("results")}</p>
        {products.isLoading ? <GridSkeleton /> : products.isError ? (
          <ErrorBlock error={products.error} onRetry={() => products.refetch()} />
        ) : (products.data ?? []).length === 0 ? (
          <div className="py-24 text-center" data-testid="status-empty">
            <p className="font-serif text-3xl">{t("noResults")}</p>
            <button onClick={() => { setSearch(""); setCat(""); }} className="mt-5 text-sm text-primary link-underline" data-testid="button-reset">{t("resetFilters")}</button>
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-5 gap-y-12 md:gap-x-8">
            {products.data!.map((p, i) => <ProductCard key={p.id} p={p} index={i} />)}
          </div>
        )}
      </div>
    </SiteLayout>
  );
}

export function ProductPage() {
  const { slug = "" } = useParams<{ slug: string }>();
  const { t, pick, lang } = useI18n();
  const fav = useFavorites();
  const q = useGetProduct(slug, { query: { queryKey: getGetProductQueryKey(slug), enabled: !!slug, retry: 1 } });
  const [active, setActive] = useState(0);
  const p = q.data;
  const Back = lang === "ar" ? ArrowRight : ArrowLeft;
  const sizes = useMemo(() => Array.from(new Set((p?.variants ?? []).map((v) => v.size))), [p]);
  const colors = useMemo(() => Array.from(new Set((p?.variants ?? []).map((v) => v.color))), [p]);
  return (
    <SiteLayout>
      <div className="max-w-7xl mx-auto px-5 md:px-10 pt-10">
        <Link href="/boutique" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary" data-testid="link-back">
          <Back className="w-4 h-4" /> {t("back")}
        </Link>
        {q.isLoading ? (
          <div className="grid md:grid-cols-2 gap-12 mt-8">
            <div className="aspect-[3/4] bg-muted animate-pulse" />
            <div className="space-y-4"><div className="h-12 bg-muted animate-pulse w-3/4" /><div className="h-4 bg-muted animate-pulse" /><div className="h-4 bg-muted animate-pulse w-2/3" /></div>
          </div>
        ) : q.isError || !p ? (
          (q.error as { status?: number } | null)?.status === 404 ? (
            <p className="font-serif text-4xl py-24 text-center" data-testid="status-not-found">{t("notFound")}</p>
          ) : <div className="mt-8"><ErrorBlock error={q.error} onRetry={() => q.refetch()} /></div>
        ) : (
          <div className="grid md:grid-cols-[1.1fr_1fr] gap-10 md:gap-16 mt-8">
            <div className="flex flex-col-reverse md:flex-row gap-4">
              {p.images.length > 1 && (
                <div className="flex md:flex-col gap-3">
                  {p.images.map((im, i) => (
                    <button key={im + i} onClick={() => setActive(i)} data-testid={`button-thumb-${i}`}
                      className={`w-16 md:w-20 aspect-[3/4] overflow-hidden rounded-sm border-2 transition-all ${active === i ? "border-primary" : "border-transparent opacity-60 hover:opacity-100"}`}>
                      <img src={asset(im)} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
              <div className="flex-1 bg-muted rounded-sm overflow-hidden">
                {p.images[active] ? <img key={active} src={asset(p.images[active])} alt={pick(p.nameFr, p.nameAr)} className="w-full h-auto rise" data-testid="img-product" />
                  : <div className="aspect-[3/4]" />}
              </div>
            </div>
            <div className="md:sticky md:top-28 self-start">
              <p className="eyebrow">{pick(p.category.nameFr, p.category.nameAr)}</p>
              <h1 className="font-serif text-5xl md:text-6xl leading-[0.95] mt-4" data-testid="text-product-name">{pick(p.nameFr, p.nameAr)}</h1>
              <p className="mt-6 inline-block text-sm px-4 py-2 rounded-full bg-[#f7e6ec] text-[#a82d64]" data-testid="text-price-status">{t("toConfirm")}</p>
              {pick(p.descriptionFr, p.descriptionAr) && (
                <p className="mt-8 text-muted-foreground leading-relaxed whitespace-pre-line">{pick(p.descriptionFr, p.descriptionAr)}</p>
              )}
              {(sizes.length > 0 || colors.length > 0) && (
                <div className="mt-8 border-t border-border pt-6 space-y-4">
                  <p className="eyebrow">{t("variants")}</p>
                  {sizes.length > 0 && <div className="flex flex-wrap gap-2 items-center"><span className="text-sm w-20 text-muted-foreground">{t("size")}</span>{sizes.map((s) => <span key={s} className="px-3 py-1 border border-border rounded-full text-sm">{s}</span>)}</div>}
                  {colors.length > 0 && <div className="flex flex-wrap gap-2 items-center"><span className="text-sm w-20 text-muted-foreground">{t("color")}</span>{colors.map((s) => <span key={s} className="px-3 py-1 border border-border rounded-full text-sm">{s}</span>)}</div>}
                </div>
              )}
              <div className="mt-10 flex flex-col gap-3">
                <CallButton label={t("askAbout")} className="justify-center" />
                <button onClick={() => fav.toggle(p.id)} data-testid="button-fav-detail"
                  className="inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-full border border-border hover:border-primary hover:text-primary transition-colors text-sm">
                  <Heart className={`w-4 h-4 ${fav.has(p.id) ? "fill-primary text-primary" : ""}`} strokeWidth={1.5} />
                  {fav.has(p.id) ? t("removeFav") : t("addFav")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </SiteLayout>
  );
}

export function AboutPage() {
  const { t } = useI18n();
  return (
    <SiteLayout>
      <PageTitle eyebrow={t("about")} title={t("aboutTitle")} />
      <section className="max-w-7xl mx-auto px-5 md:px-10 grid md:grid-cols-2 gap-12 items-start">
        <img src={asset("/products/dress-2.jpeg")} alt="" className="w-full h-auto rounded-sm" />
        <div className="md:pt-10 space-y-6 text-lg leading-relaxed text-foreground/80">
          <p className="font-serif text-3xl leading-snug text-foreground">{t("aboutText1")}</p>
          <p>{t("aboutText2")}</p>
        </div>
      </section>
      <section className="max-w-7xl mx-auto px-5 md:px-10 mt-24">
        <p className="eyebrow">{t("values")}</p>
        <div className="grid md:grid-cols-3 gap-px bg-border mt-6 border border-border">
          {(["1", "2", "3"] as const).map((n) => (
            <div key={n} className="bg-background p-8 hover:bg-[#fbf1f4] transition-colors">
              <p className="font-serif italic text-secondary text-xl">0{n}</p>
              <p className="font-serif text-3xl mt-3">{t(`v${n}t`)}</p>
              <p className="text-sm text-muted-foreground mt-2">{t(`v${n}`)}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="max-w-7xl mx-auto px-5 md:px-10 mt-20 grid grid-cols-3 gap-4">
        {[4, 5, 6].map((n) => <img key={n} src={asset(`/products/dress-${n}.jpeg`)} alt="" className="w-full aspect-[3/4] object-cover rounded-sm" />)}
      </section>
    </SiteLayout>
  );
}

export function ContactPage() {
  const { t } = useI18n();
  const store = useStoreInfo();
  const phone = store.data?.phone || FALLBACK_PHONE;
  return (
    <SiteLayout>
      <PageTitle eyebrow={t("contact")} title={t("contactTitle")}>
        <p className="mt-6 text-muted-foreground max-w-xl">{t("contactText")}</p>
      </PageTitle>
      <section className="max-w-7xl mx-auto px-5 md:px-10 grid md:grid-cols-2 gap-6">
        <a href={telHref(phone)} data-testid="link-contact-phone"
          className="group bg-[#282326] text-[#f6efe9] rounded-sm p-10 md:p-14 flex flex-col justify-between min-h-72 hover:bg-primary transition-colors duration-500">
          <Phone className="w-6 h-6" strokeWidth={1.3} />
          <div>
            <p className="text-[11px] tracking-[0.25em] uppercase opacity-70">{t("phone")}</p>
            <p className="font-serif text-5xl md:text-6xl mt-2" dir="ltr">{phone}</p>
          </div>
        </a>
        <div className="border border-border rounded-sm p-10 md:p-14 flex flex-col justify-between gap-10 min-h-72">
          <div className="flex gap-3 items-start">
            <MapPin className="w-5 h-5 text-secondary mt-1" strokeWidth={1.4} />
            <div>
              <p className="eyebrow">{t("location")}</p>
              {store.isLoading ? <div className="h-6 w-48 bg-muted animate-pulse mt-2" /> :
                <p className="font-serif text-3xl mt-2">{store.data?.location || "Relizane"}</p>}
            </div>
          </div>
          <div>
            <p className="eyebrow mb-3">{t("socials")}</p>
            {store.isError ? <ErrorBlock error={store.error} onRetry={() => store.refetch()} /> : <Socials tone="dark" />}
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}

export function FavoritesPage() {
  const { t } = useI18n();
  const fav = useFavorites();
  const products = useListProducts(undefined, { query: { queryKey: getListProductsQueryKey() } });
  const list = (products.data ?? []).filter((p) => fav.ids.includes(p.id));
  return (
    <SiteLayout>
      <PageTitle eyebrow={t("favorites")} title={t("favorites")}>
        <p className="mt-4 text-sm text-muted-foreground">{t("favText")}</p>
      </PageTitle>
      <div className="max-w-7xl mx-auto px-5 md:px-10">
        {products.isLoading ? <GridSkeleton n={3} /> : products.isError ? <ErrorBlock error={products.error} onRetry={() => products.refetch()} /> :
          list.length === 0 ? (
            <div className="py-20 text-center border border-dashed border-border rounded-sm" data-testid="status-empty">
              <Heart className="w-8 h-8 mx-auto text-primary/50" strokeWidth={1.2} />
              <p className="font-serif text-3xl mt-4">{t("favEmpty")}</p>
              <Link href="/boutique" className="inline-block mt-6 text-sm text-primary link-underline">{t("discover")}</Link>
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-5 gap-y-12 md:gap-x-8">
              {list.map((p, i) => <ProductCard key={p.id} p={p} index={i} />)}
            </div>
          )}
      </div>
    </SiteLayout>
  );
}
