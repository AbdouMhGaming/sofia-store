import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, Redirect } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  Archive, Boxes, Check, Copy, KeyRound, LayoutGrid, LogOut, Package, Pencil, Plus, ScrollText, ShoppingBag, ExternalLink, AlertTriangle,
} from "lucide-react";
import {
  useLogin, useLogout, useChangePassword, useActivateOwner, useGetAdminSummary, useListAdminProducts, useCreateProduct,
  useUpdateProduct, useCreateVariant, useListInventory, useAdjustStock, useListActivity, useListCategories,
  getGetSessionQueryKey, getGetAdminSummaryQueryKey, getListAdminProductsQueryKey, getListInventoryQueryKey,
  getListActivityQueryKey, getListProductsQueryKey, getListCategoriesQueryKey,
  type AdminProduct, type ActivationResult, type InventoryRow, type Session, type Activity, type AdjustmentInputKind, type ProductInputStatus,
} from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useSessionCsrf } from "@/lib/auth";
import { PRODUCT_IMAGES, asset, daToMinor, errMsg, formatDA } from "@/lib/util";
import { Logo } from "@/components/site";

const inputCls = "w-full px-3.5 py-2.5 rounded-md bg-background border border-input text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition";
const btnDark = "inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-full bg-[#282326] text-[#f6efe9] text-sm hover:bg-primary transition-colors disabled:opacity-50 disabled:pointer-events-none";
const btnGhost = "inline-flex items-center justify-center gap-2 px-4 py-2 rounded-full border border-border text-sm hover:border-primary hover:text-primary transition-colors disabled:opacity-50";

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs tracking-wide uppercase text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

function ErrorText({ e }: { e: unknown }) {
  if (!e) return null;
  return <p className="text-sm text-destructive bg-destructive/5 border border-destructive/20 rounded-md px-3 py-2" data-testid="text-error">{errMsg(e)}</p>;
}

function Skel({ h = "h-40" }: { h?: string }) {
  return <div className={`${h} bg-muted animate-pulse rounded-md`} />;
}

function useSetSession() {
  const qc = useQueryClient();
  return (s: Session) => qc.setQueryData(getGetSessionQueryKey(), s);
}

/* ---------- Auth screens ---------- */

function AuthFrame({ children, title, sub }: { children: ReactNode; title: string; sub?: string }) {
  return (
    <div className="min-h-[100dvh] grid md:grid-cols-[1fr_1.1fr] bg-background" dir="ltr">
      <div className="hidden md:block relative bg-[#f7e6ec]">
        <img src={asset("/products/dress-3.jpeg")} alt="" className="absolute inset-0 w-full h-full object-cover opacity-90" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#282326]/60 to-transparent" />
        <p className="absolute bottom-10 left-10 right-10 font-serif italic text-3xl text-[#f6efe9]">Inventaire partagé, en toute clarté.</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-md rise">
          <Link href="/"><Logo className="h-20 mx-auto" /></Link>
          <h1 className="font-serif text-4xl text-center mt-6">{title}</h1>
          {sub && <p className="text-sm text-muted-foreground text-center mt-2">{sub}</p>}
          <div className="mt-8">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function AdminLoginPage() {
  const { session, request } = useSessionCsrf();
  const setSession = useSetSession();
  const [, nav] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "activate">("login");
  const [actEmail, setActEmail] = useState("");
  const [token, setToken] = useState("");
  const [result, setResult] = useState<ActivationResult | null>(null);
  const [copied, setCopied] = useState(false);
  const login = useLogin({ request });
  const activate = useActivateOwner({ request });
  const qc = useQueryClient();

  if (session.isLoading) return <AuthFrame title="Espace équipe"><Skel /></AuthFrame>;
  if (session.isError) return <AuthFrame title="Espace équipe"><ErrorText e={session.error} /><button className={`${btnGhost} mt-4`} onClick={() => session.refetch()}>Réessayer</button></AuthFrame>;
  if (session.data?.user && !result) return <Redirect to="/admin" />;
  const s = session.data!;

  if (result) {
    return (
      <AuthFrame title="Compte activé" sub="Ce mot de passe temporaire ne sera plus jamais affiché.">
        <div className="space-y-4">
          <div className="rounded-md border border-secondary/40 bg-[#fbf1ea] p-4 text-sm flex gap-3">
            <AlertTriangle className="w-4 h-4 text-secondary shrink-0 mt-0.5" />
            Notez-le maintenant. Vous devrez le remplacer à la première connexion.
          </div>
          <Field label="E-mail"><p className="font-medium" data-testid="text-activated-email">{result.email}</p></Field>
          <Field label="Mot de passe temporaire">
            <div className="flex gap-2">
              <code className="flex-1 px-3 py-2.5 rounded-md bg-muted font-mono text-sm break-all select-all" data-testid="text-temp-password">{result.temporaryPassword}</code>
              <button className={btnGhost} data-testid="button-copy-password" onClick={async () => {
                await navigator.clipboard.writeText(result.temporaryPassword); setCopied(true);
              }}>{copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}</button>
            </div>
          </Field>
          <button className={`${btnDark} w-full`} data-testid="button-proceed-login" onClick={() => {
            setEmail(result.email); setResult(null); setMode("login");
            qc.invalidateQueries({ queryKey: getGetSessionQueryKey() });
          }}>Continuer vers la connexion</button>
        </div>
      </AuthFrame>
    );
  }

  const canActivate = s.setupRequired && s.setupEnabled;
  return (
    <AuthFrame title={mode === "login" ? "Espace équipe" : "Activer le compte propriétaire"} sub="Accès réservé à l'équipe SOFIA STORE.">
      {s.setupRequired && !s.setupEnabled && (
        <div className="mb-6 rounded-md border border-secondary/40 bg-[#fbf1ea] p-4 text-sm" data-testid="status-setup-disabled">
          Aucun compte propriétaire n'existe encore. La clé d'activation sécurisée doit d'abord être configurée sur le serveur.
        </div>
      )}
      {mode === "login" ? (
        <form className="space-y-4" onSubmit={(e) => {
          e.preventDefault();
          login.mutate({ data: { email: email.trim(), password } }, { onSuccess: (ns) => { setSession(ns); nav("/admin"); } });
        }}>
          <Field label="E-mail"><input type="email" required autoComplete="username" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-email" /></Field>
          <Field label="Mot de passe"><input type="password" required autoComplete="current-password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} data-testid="input-password" /></Field>
          <ErrorText e={login.error} />
          <button className={`${btnDark} w-full`} disabled={login.isPending || !s.csrfToken} data-testid="button-login">{login.isPending ? "Connexion…" : "Se connecter"}</button>
          {canActivate && <button type="button" className="w-full text-sm text-primary link-underline" onClick={() => setMode("activate")} data-testid="button-show-activate">Première activation du propriétaire</button>}
        </form>
      ) : (
        <form className="space-y-4" onSubmit={(e) => {
          e.preventDefault();
          activate.mutate({ data: { email: actEmail.trim(), token: token.trim() } }, { onSuccess: (r) => setResult(r) });
        }}>
          <Field label="E-mail du propriétaire"><input type="email" required className={inputCls} value={actEmail} onChange={(e) => setActEmail(e.target.value)} data-testid="input-activate-email" /></Field>
          <Field label="Clé d'activation secrète" hint="Minimum 24 caractères, fournie lors de la configuration."><input type="password" required minLength={24} className={inputCls} value={token} onChange={(e) => setToken(e.target.value)} data-testid="input-activate-token" /></Field>
          <ErrorText e={activate.error} />
          <button className={`${btnDark} w-full`} disabled={activate.isPending} data-testid="button-activate">{activate.isPending ? "Activation…" : "Activer"}</button>
          <button type="button" className="w-full text-sm text-muted-foreground" onClick={() => setMode("login")}>Retour à la connexion</button>
        </form>
      )}
    </AuthFrame>
  );
}

function ChangePasswordScreen() {
  const { request } = useSessionCsrf();
  const setSession = useSetSession();
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [local, setLocal] = useState("");
  const change = useChangePassword({ request });
  return (
    <AuthFrame title="Nouveau mot de passe" sub="Pour votre sécurité, remplacez le mot de passe temporaire avant de continuer.">
      <form className="space-y-4" onSubmit={(e) => {
        e.preventDefault(); setLocal("");
        if (next.length < 14) return setLocal("Le nouveau mot de passe doit contenir au moins 14 caractères.");
        if (next !== confirm) return setLocal("Les deux mots de passe ne correspondent pas.");
        change.mutate({ data: { currentPassword: cur, newPassword: next } }, { onSuccess: (s) => setSession(s) });
      }}>
        <Field label="Mot de passe actuel"><input type="password" required className={inputCls} value={cur} onChange={(e) => setCur(e.target.value)} data-testid="input-current-password" /></Field>
        <Field label="Nouveau mot de passe" hint={`${next.length}/14 caractères minimum`}><input type="password" required minLength={14} className={inputCls} value={next} onChange={(e) => setNext(e.target.value)} data-testid="input-new-password" /></Field>
        <Field label="Confirmer"><input type="password" required className={inputCls} value={confirm} onChange={(e) => setConfirm(e.target.value)} data-testid="input-confirm-password" /></Field>
        {local && <p className="text-sm text-destructive">{local}</p>}
        <ErrorText e={change.error} />
        <button className={`${btnDark} w-full`} disabled={change.isPending} data-testid="button-change-password">{change.isPending ? "Enregistrement…" : "Enregistrer"}</button>
      </form>
    </AuthFrame>
  );
}

/* ---------- Shell ---------- */

const NAV = [
  { href: "/admin", label: "Tableau de bord", icon: LayoutGrid },
  { href: "/admin/produits", label: "Produits", icon: Package },
  { href: "/admin/inventaire", label: "Inventaire", icon: Boxes },
  { href: "/admin/activite", label: "Activité", icon: ScrollText },
  { href: "/pos", label: "Caisse", icon: ShoppingBag },
];

function AdminShell({ title, sub, actions, children }: { title: string; sub?: string; actions?: ReactNode; children: ReactNode }) {
  const { session, request } = useSessionCsrf();
  const [loc, nav] = useLocation();
  const qc = useQueryClient();
  const logout = useLogout({ request });
  if (session.isLoading) return <div className="p-10"><Skel h="h-96" /></div>;
  if (session.isError) return <div className="p-10 max-w-md"><ErrorText e={session.error} /><button className={`${btnGhost} mt-4`} onClick={() => session.refetch()}>Réessayer</button></div>;
  const user = session.data?.user;
  if (!user) return <Redirect to="/admin/login" />;
  if (user.mustChangePassword) return <ChangePasswordScreen />;
  return (
    <div className="min-h-[100dvh] md:grid md:grid-cols-[250px_1fr] bg-[#fbf8f5]" dir="ltr">
      <aside className="bg-sidebar border-e border-sidebar-border md:sticky md:top-0 md:h-[100dvh] flex md:flex-col">
        <div className="p-5 hidden md:block"><Link href="/"><Logo className="h-16" /></Link></div>
        <nav className="flex md:flex-col gap-1 px-3 py-3 overflow-x-auto flex-1">
          {NAV.map((n) => {
            const on = n.href === "/admin" ? loc === "/admin" : loc.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} data-testid={`link-admin-${n.href.split("/").pop()}`}
                className={`shrink-0 flex items-center gap-3 px-3.5 py-2.5 rounded-md text-sm transition-all ${on ? "bg-[#282326] text-[#f6efe9]" : "hover:bg-sidebar-accent hover:translate-x-0.5"}`}>
                <n.icon className={`w-4 h-4 ${on ? "text-primary" : ""}`} strokeWidth={1.6} />{n.label}
              </Link>
            );
          })}
        </nav>
        <div className="hidden md:block p-4 border-t border-sidebar-border text-xs">
          <p className="truncate font-medium" data-testid="text-user-email">{user.email}</p>
          <p className="text-muted-foreground mt-0.5">{user.role}</p>
          <div className="flex gap-2 mt-3">
            <Link href="/" className={`${btnGhost} !px-3 !py-1.5 text-xs`}><ExternalLink className="w-3 h-3" />Site</Link>
            <button className={`${btnGhost} !px-3 !py-1.5 text-xs`} disabled={logout.isPending} data-testid="button-logout"
              onClick={() => logout.mutate(undefined, { onSuccess: () => { qc.clear(); nav("/admin/login"); } })}>
              <LogOut className="w-3 h-3" />Quitter
            </button>
          </div>
          {logout.error && <p className="text-destructive mt-2">{errMsg(logout.error)}</p>}
        </div>
      </aside>
      <main className="p-5 md:p-10 min-w-0">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
          <div>
            <p className="eyebrow">SOFIA STORE · Gestion</p>
            <h1 className="font-serif text-4xl md:text-5xl mt-2">{title}</h1>
            {sub && <p className="text-sm text-muted-foreground mt-1">{sub}</p>}
          </div>
          {actions}
        </div>
        <div className="rise">{children}</div>
      </main>
    </div>
  );
}

/* ---------- Dashboard ---------- */

export function AdminDashboardPage() {
  const { session } = useSessionCsrf();
  const enabled = !!session.data?.user && !session.data.user.mustChangePassword;
  const q = useGetAdminSummary({ query: { queryKey: getGetAdminSummaryQueryKey(), enabled, refetchInterval: 30_000 } });
  const s = q.data;
  const stats = s ? [
    { label: "Produits", v: s.products },
    { label: "Déclinaisons", v: s.variants },
    { label: "Unités disponibles", v: s.availableUnits },
    { label: "Unités réservées", v: s.reservedUnits },
    { label: "Stock bas", v: s.lowStock, warn: s.lowStock > 0 },
  ] : [];
  return (
    <AdminShell title="Tableau de bord" sub="Données réelles du catalogue et du stock.">
      {q.isLoading || !enabled ? <Skel h="h-64" /> : q.isError ? <><ErrorText e={q.error} /><button className={`${btnGhost} mt-3`} onClick={() => q.refetch()}>Réessayer</button></> : s && (
        <div className="space-y-8">
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-px bg-border border border-border rounded-md overflow-hidden">
            {stats.map((x) => (
              <div key={x.label} className="bg-card p-5" data-testid={`stat-${x.label}`}>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{x.label}</p>
                <p className={`font-serif text-4xl mt-2 ${x.warn ? "text-secondary" : ""}`}>{x.v.toLocaleString("fr-FR")}</p>
              </div>
            ))}
            <div className="bg-[#282326] text-[#f6efe9] p-5 col-span-2 lg:col-span-1">
              <p className="text-xs uppercase tracking-wide opacity-70">Valeur au coût</p>
              <p className="font-serif text-3xl mt-2" data-testid="stat-valuation">{formatDA(s.valuationMinor)}</p>
            </div>
          </div>
          <div className="grid lg:grid-cols-[1.5fr_1fr] gap-6">
            <div className="bg-card border border-border rounded-md p-6">
              <div className="flex justify-between items-center mb-4"><h2 className="font-serif text-2xl">Activité récente</h2><Link href="/admin/activite" className="text-sm text-primary link-underline">Tout voir</Link></div>
              <ActivityList items={s.recentActivity} />
            </div>
            <div className="bg-[#f7e6ec]/60 border border-primary/15 rounded-md p-6 space-y-3">
              <h2 className="font-serif text-2xl">Raccourcis</h2>
              <Link href="/admin/produits" className="flex items-center gap-3 p-3 rounded-md bg-background hover:translate-x-1 transition-transform"><Plus className="w-4 h-4 text-primary" />Créer ou modifier un produit</Link>
              <Link href="/admin/inventaire" className="flex items-center gap-3 p-3 rounded-md bg-background hover:translate-x-1 transition-transform"><Boxes className="w-4 h-4 text-primary" />Enregistrer un mouvement de stock</Link>
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  );
}

function ActivityList({ items }: { items: Activity[] }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground py-8 text-center" data-testid="status-activity-empty">Aucune activité enregistrée pour l'instant.</p>;
  return (
    <ol className="relative border-s border-border ms-2">
      {items.map((a) => (
        <li key={a.id} className="ps-5 pb-5 relative" data-testid={`row-activity-${a.id}`}>
          <span className="absolute -start-[5px] top-1.5 w-2.5 h-2.5 rounded-full bg-primary ring-4 ring-card" />
          <p className="text-sm"><span className="font-medium">{a.action}</span> <span className="text-muted-foreground">· {a.actor}</span></p>
          {a.detail && <p className="text-sm text-foreground/75 mt-0.5">{a.detail}</p>}
          <p className="text-xs text-muted-foreground mt-1">{new Date(a.createdAt).toLocaleString("fr-FR")}</p>
        </li>
      ))}
    </ol>
  );
}

export function AdminActivityPage() {
  const { session } = useSessionCsrf();
  const enabled = !!session.data?.user && !session.data.user.mustChangePassword;
  const q = useListActivity({ query: { queryKey: getListActivityQueryKey(), enabled, refetchInterval: 30_000 } });
  return (
    <AdminShell title="Activité" sub="Journal d'audit des actions récentes.">
      <div className="bg-card border border-border rounded-md p-6 max-w-3xl">
        {q.isLoading || !enabled ? <Skel /> : q.isError ? <ErrorText e={q.error} /> : <ActivityList items={q.data ?? []} />}
      </div>
    </AdminShell>
  );
}

/* ---------- Products ---------- */

const STATUS_LABEL: Record<string, string> = { PREVIEW: "Aperçu", ACTIVE: "Actif", ARCHIVED: "Archivé" };
const STATUS_CLS: Record<string, string> = { PREVIEW: "bg-[#fbf1ea] text-[#a65429]", ACTIVE: "bg-[#f7e6ec] text-[#a82d64]", ARCHIVED: "bg-muted text-muted-foreground" };

function useInvalidateCatalog() {
  const qc = useQueryClient();
  return () => {
    for (const k of [getListAdminProductsQueryKey(), getGetAdminSummaryQueryKey(), getListInventoryQueryKey(), getListActivityQueryKey(), getListProductsQueryKey()]) {
      qc.invalidateQueries({ queryKey: k });
    }
    qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/products") });
  };
}

function toInput(p: AdminProduct, status?: ProductInputStatus) {
  return {
    nameFr: p.nameFr, nameAr: p.nameAr, descriptionFr: p.descriptionFr, descriptionAr: p.descriptionAr,
    categoryId: p.categoryId, featured: p.featured, status: status ?? p.status, images: p.images,
  };
}

export function AdminProductsPage() {
  const { session, request } = useSessionCsrf();
  const enabled = !!session.data?.user && !session.data.user.mustChangePassword;
  const q = useListAdminProducts({ query: { queryKey: getListAdminProductsQueryKey(), enabled } });
  const [editing, setEditing] = useState<AdminProduct | "new" | null>(null);
  const [variantFor, setVariantFor] = useState<AdminProduct | null>(null);
  const [filter, setFilter] = useState<"ALL" | ProductInputStatus>("ALL");
  const invalidate = useInvalidateCatalog();
  const update = useUpdateProduct({ request });
  const list = (q.data ?? []).filter((p) => filter === "ALL" || p.status === filter);
  return (
    <AdminShell title="Produits" sub="Fiches catalogue, statut et déclinaisons."
      actions={<button className={btnDark} onClick={() => setEditing("new")} data-testid="button-new-product"><Plus className="w-4 h-4" />Nouveau produit</button>}>
      <div className="flex gap-2 mb-5">
        {(["ALL", "PREVIEW", "ACTIVE", "ARCHIVED"] as const).map((s) => (
          <button key={s} onClick={() => setFilter(s)} className={`px-3.5 py-1.5 rounded-full text-xs border transition ${filter === s ? "bg-[#282326] text-[#f6efe9] border-[#282326]" : "border-border hover:border-primary"}`} data-testid={`button-filter-${s}`}>
            {s === "ALL" ? "Tous" : STATUS_LABEL[s]}
          </button>
        ))}
      </div>
      {update.error && <div className="mb-4"><ErrorText e={update.error} /></div>}
      {q.isLoading || !enabled ? <Skel h="h-80" /> : q.isError ? <><ErrorText e={q.error} /><button className={`${btnGhost} mt-3`} onClick={() => q.refetch()}>Réessayer</button></> :
        list.length === 0 ? (
          <div className="border border-dashed border-border rounded-md py-16 text-center" data-testid="status-products-empty">
            <Package className="w-8 h-8 mx-auto text-primary/50" strokeWidth={1.2} />
            <p className="font-serif text-2xl mt-3">Aucun produit ici.</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {list.map((p) => (
              <div key={p.id} className="bg-card border border-border rounded-md p-3 flex flex-wrap md:flex-nowrap items-center gap-4 hover:border-primary/40 transition-colors" data-testid={`row-product-${p.id}`}>
                <div className="w-14 h-[74px] bg-muted rounded-sm overflow-hidden shrink-0">{p.images[0] && <img src={asset(p.images[0])} alt="" className="w-full h-full object-cover" />}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-serif text-xl truncate">{p.nameFr}</p>
                    <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full ${STATUS_CLS[p.status]}`}>{STATUS_LABEL[p.status]}</span>
                    {p.featured && <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border border-primary/40 text-primary">Vitrine</span>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{p.category.nameFr} · {p.variants.length} déclinaison(s){p.nameAr && <> · <span dir="rtl">{p.nameAr}</span></>}</p>
                  {p.variants.length > 0 && <p className="text-xs text-muted-foreground mt-1 truncate">{p.variants.map((v) => `${v.size}/${v.color} (${v.sku})`).join(" · ")}</p>}
                </div>
                <div className="flex gap-2 shrink-0">
                  <button className={btnGhost} onClick={() => setVariantFor(p)} data-testid={`button-add-variant-${p.id}`}><Plus className="w-3.5 h-3.5" />Déclinaison</button>
                  <button className={btnGhost} onClick={() => setEditing(p)} data-testid={`button-edit-${p.id}`}><Pencil className="w-3.5 h-3.5" /></button>
                  {p.status !== "ARCHIVED" ? (
                    <button className={btnGhost} disabled={update.isPending} data-testid={`button-archive-${p.id}`} title="Archiver"
                      onClick={() => { if (confirm(`Archiver « ${p.nameFr} » ? Le produit ne sera plus visible publiquement.`)) update.mutate({ id: p.id, data: toInput(p, "ARCHIVED") }, { onSuccess: invalidate }); }}>
                      <Archive className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <button className={btnGhost} disabled={update.isPending} data-testid={`button-restore-${p.id}`}
                      onClick={() => update.mutate({ id: p.id, data: toInput(p, "PREVIEW") }, { onSuccess: invalidate })}>Restaurer</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      <ProductDialog product={editing} onClose={() => setEditing(null)} />
      <VariantDialog product={variantFor} onClose={() => setVariantFor(null)} />
    </AdminShell>
  );
}

function ProductDialog({ product, onClose }: { product: AdminProduct | "new" | null; onClose: () => void }) {
  const { request } = useSessionCsrf();
  const cats = useListCategories({ query: { queryKey: getListCategoriesQueryKey() } });
  const create = useCreateProduct({ request });
  const update = useUpdateProduct({ request });
  const invalidate = useInvalidateCatalog();
  const blank = { nameFr: "", nameAr: "", descriptionFr: "", descriptionAr: "", categoryId: 0, featured: false, status: "PREVIEW" as ProductInputStatus, images: [] as string[] };
  const [f, setF] = useState(blank);
  const [local, setLocal] = useState("");
  useEffect(() => {
    if (product === "new") setF({ ...blank, categoryId: cats.data?.[0]?.id ?? 0 });
    else if (product) setF(toInput(product));
    setLocal(""); create.reset(); update.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product]);
  const isNew = product === "new";
  const pending = create.isPending || update.isPending;
  const toggleImg = (src: string) => setF((s) => ({ ...s, images: s.images.includes(src) ? s.images.filter((x) => x !== src) : [...s.images, src] }));
  const submit = () => {
    setLocal("");
    if (!f.nameFr.trim()) return setLocal("Le nom en français est obligatoire.");
    if (!f.categoryId) return setLocal("Choisissez une catégorie.");
    const data = { ...f, nameFr: f.nameFr.trim(), nameAr: f.nameAr.trim() };
    const done = { onSuccess: () => { invalidate(); onClose(); } };
    if (isNew) create.mutate({ data }, done);
    else if (product) update.mutate({ id: product.id, data }, done);
  };
  return (
    <Dialog open={!!product} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto" dir="ltr">
        <DialogHeader>
          <DialogTitle className="font-serif text-3xl font-normal">{isNew ? "Nouveau produit" : "Modifier le produit"}</DialogTitle>
          <DialogDescription>Les prix se définissent sur chaque déclinaison.</DialogDescription>
        </DialogHeader>
        <div className="grid md:grid-cols-2 gap-4">
          <Field label="Nom (FR) *"><input className={inputCls} maxLength={150} value={f.nameFr} onChange={(e) => setF({ ...f, nameFr: e.target.value })} data-testid="input-name-fr" /></Field>
          <Field label="Nom (AR)"><input className={inputCls} dir="rtl" maxLength={150} value={f.nameAr} onChange={(e) => setF({ ...f, nameAr: e.target.value })} data-testid="input-name-ar" /></Field>
          <Field label="Description (FR)"><textarea rows={4} className={inputCls} maxLength={5000} value={f.descriptionFr} onChange={(e) => setF({ ...f, descriptionFr: e.target.value })} data-testid="input-desc-fr" /></Field>
          <Field label="Description (AR)"><textarea rows={4} dir="rtl" className={inputCls} maxLength={5000} value={f.descriptionAr} onChange={(e) => setF({ ...f, descriptionAr: e.target.value })} data-testid="input-desc-ar" /></Field>
          <Field label="Catégorie">
            <select className={inputCls} value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: Number(e.target.value) })} data-testid="select-category">
              <option value={0} disabled>{cats.isLoading ? "Chargement…" : "Choisir…"}</option>
              {(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.nameFr}</option>)}
            </select>
          </Field>
          <Field label="Statut">
            <select className={inputCls} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as ProductInputStatus })} data-testid="select-status">
              {(["PREVIEW", "ACTIVE", "ARCHIVED"] as const).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </Field>
        </div>
        <label className="flex items-center gap-3 text-sm mt-1 cursor-pointer">
          <input type="checkbox" checked={f.featured} onChange={(e) => setF({ ...f, featured: e.target.checked })} className="accent-[#F04F94] w-4 h-4" data-testid="checkbox-featured" />
          Mettre en vitrine sur l'accueil
        </label>
        <div>
          <p className="text-xs tracking-wide uppercase text-muted-foreground mb-2">Images ({f.images.length}) — l'ordre de sélection définit l'ordre d'affichage</p>
          <div className="grid grid-cols-6 gap-2">
            {PRODUCT_IMAGES.map((src) => {
              const idx = f.images.indexOf(src);
              return (
                <button type="button" key={src} onClick={() => toggleImg(src)} data-testid={`button-image-${src.split("/").pop()}`}
                  className={`relative aspect-[3/4] rounded-sm overflow-hidden border-2 transition-all ${idx >= 0 ? "border-primary" : "border-transparent opacity-55 hover:opacity-100"}`}>
                  <img src={asset(src)} alt="" className="w-full h-full object-cover" />
                  {idx >= 0 && <span className="absolute top-1 right-1 w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] grid place-items-center">{idx + 1}</span>}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground mt-2">Le téléversement de nouvelles photos arrivera dans une phase suivante.</p>
        </div>
        {local && <p className="text-sm text-destructive">{local}</p>}
        <ErrorText e={create.error || update.error} />
        <div className="flex justify-end gap-2 pt-2">
          <button className={btnGhost} onClick={onClose}>Annuler</button>
          <button className={btnDark} disabled={pending} onClick={submit} data-testid="button-save-product">{pending ? "Enregistrement…" : "Enregistrer"}</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function VariantDialog({ product, onClose }: { product: AdminProduct | null; onClose: () => void }) {
  const { request } = useSessionCsrf();
  const create = useCreateVariant({ request });
  const invalidate = useInvalidateCatalog();
  const blank = { sku: "", barcode: "", size: "", color: "", price: "", cost: "" };
  const [f, setF] = useState(blank);
  const [local, setLocal] = useState("");
  useEffect(() => { setF(blank); setLocal(""); create.reset(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [product]);
  const submit = () => {
    setLocal("");
    const priceMinor = daToMinor(f.price);
    const costMinor = daToMinor(f.cost || "0");
    if (!f.sku.trim() || !f.barcode.trim() || !f.size.trim() || !f.color.trim()) return setLocal("SKU, code-barres, taille et couleur sont obligatoires.");
    if (priceMinor === null || priceMinor < 1) return setLocal("Prix de vente invalide (ex. 4500 ou 4500,50).");
    if (costMinor === null) return setLocal("Coût invalide (ex. 2800 ou 2800,00).");
    if (priceMinor > 100000000 || costMinor > 100000000) return setLocal("Montant trop élevé.");
    create.mutate({ id: product!.id, data: { sku: f.sku.trim(), barcode: f.barcode.trim(), size: f.size.trim(), color: f.color.trim(), priceMinor, costMinor } },
      { onSuccess: () => { invalidate(); onClose(); } });
  };
  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Dialog open={!!product} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg" dir="ltr">
        <DialogHeader>
          <DialogTitle className="font-serif text-3xl font-normal">Nouvelle déclinaison</DialogTitle>
          <DialogDescription>{product?.nameFr} — le stock démarre à zéro ; ajoutez-le ensuite depuis l'inventaire.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <Field label="SKU"><input className={inputCls} maxLength={80} value={f.sku} onChange={set("sku")} data-testid="input-sku" /></Field>
          <Field label="Code-barres"><input className={inputCls} maxLength={80} value={f.barcode} onChange={set("barcode")} data-testid="input-barcode" /></Field>
          <Field label="Taille"><input className={inputCls} maxLength={30} value={f.size} onChange={set("size")} data-testid="input-size" /></Field>
          <Field label="Couleur"><input className={inputCls} maxLength={60} value={f.color} onChange={set("color")} data-testid="input-color" /></Field>
          <Field label="Prix de vente (DA)"><input inputMode="decimal" className={inputCls} value={f.price} onChange={set("price")} placeholder="4500,00" data-testid="input-price" /></Field>
          <Field label="Coût d'achat (DA)" hint="Interne, jamais affiché publiquement."><input inputMode="decimal" className={inputCls} value={f.cost} onChange={set("cost")} placeholder="0" data-testid="input-cost" /></Field>
        </div>
        {local && <p className="text-sm text-destructive">{local}</p>}
        <ErrorText e={create.error} />
        <div className="flex justify-end gap-2 pt-2">
          <button className={btnGhost} onClick={onClose}>Annuler</button>
          <button className={btnDark} disabled={create.isPending} onClick={submit} data-testid="button-save-variant">{create.isPending ? "Création…" : "Créer"}</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Inventory ---------- */

const KIND_LABEL: Record<AdjustmentInputKind, string> = { RECEIPT: "Réception", ADJUSTMENT: "Correction", DAMAGE: "Dommage", RETURN: "Retour" };

export function AdminInventoryPage() {
  const { session } = useSessionCsrf();
  const enabled = !!session.data?.user && !session.data.user.mustChangePassword;
  const q = useListInventory({ query: { queryKey: getListInventoryQueryKey(), enabled, refetchInterval: 30_000 } });
  const [search, setSearch] = useState("");
  const [row, setRow] = useState<InventoryRow | null>(null);
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data ?? []).filter((r) => !s || [r.productName, r.sku, r.barcode, r.size, r.color].some((x) => x.toLowerCase().includes(s)));
  }, [q.data, search]);
  return (
    <AdminShell title="Inventaire" sub="Soldes calculés par le serveur. Chaque mouvement est tracé.">
      <input className={`${inputCls} max-w-sm mb-5`} placeholder="Rechercher produit, SKU, code-barres…" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-inventory-search" />
      {q.isLoading || !enabled ? <Skel h="h-80" /> : q.isError ? <><ErrorText e={q.error} /><button className={`${btnGhost} mt-3`} onClick={() => q.refetch()}>Réessayer</button></> :
        rows.length === 0 ? (
          <div className="border border-dashed border-border rounded-md py-16 text-center" data-testid="status-inventory-empty">
            <Boxes className="w-8 h-8 mx-auto text-primary/50" strokeWidth={1.2} />
            <p className="font-serif text-2xl mt-3">Aucune déclinaison.</p>
            <p className="text-sm text-muted-foreground mt-1">Créez des déclinaisons depuis la page Produits.</p>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-md overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted-foreground bg-muted/50">
                <tr>{["Article", "SKU / Code", "Taille", "Couleur", "Prix", "Coût", "En stock", "Réservé", "Dispo.", ""].map((h) => <th key={h} className="text-left font-medium px-4 py-3 whitespace-nowrap">{h}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-border hover:bg-[#fbf1f4] transition-colors" data-testid={`row-inventory-${r.id}`}>
                    <td className="px-4 py-3"><div className="flex items-center gap-3"><div className="w-9 h-12 bg-muted rounded-sm overflow-hidden shrink-0">{r.image && <img src={asset(r.image)} alt="" className="w-full h-full object-cover" />}</div><span className="font-medium">{r.productName}</span></div></td>
                    <td className="px-4 py-3 font-mono text-xs">{r.sku}<br /><span className="text-muted-foreground">{r.barcode}</span></td>
                    <td className="px-4 py-3">{r.size}</td>
                    <td className="px-4 py-3">{r.color}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{formatDA(r.priceMinor)}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{formatDA(r.costMinor)}</td>
                    <td className="px-4 py-3 tabular-nums">{r.onHand}</td>
                    <td className="px-4 py-3 tabular-nums">{r.reserved}</td>
                    <td className={`px-4 py-3 tabular-nums font-semibold ${r.available <= 0 ? "text-destructive" : r.available <= 2 ? "text-secondary" : ""}`} data-testid={`text-available-${r.id}`}>{r.available}</td>
                    <td className="px-4 py-3"><button className={btnGhost} onClick={() => setRow(r)} data-testid={`button-adjust-${r.id}`}>Mouvement</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      <AdjustDialog row={row} onClose={() => setRow(null)} />
    </AdminShell>
  );
}

function AdjustDialog({ row, onClose }: { row: InventoryRow | null; onClose: () => void }) {
  const { request } = useSessionCsrf();
  const adjust = useAdjustStock({ request });
  const invalidate = useInvalidateCatalog();
  const [kind, setKind] = useState<AdjustmentInputKind>("RECEIPT");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [local, setLocal] = useState("");
  const requestId = useRef("");
  useEffect(() => {
    if (row) { requestId.current = crypto.randomUUID(); setKind("RECEIPT"); setQty(""); setReason(""); setLocal(""); adjust.reset(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row]);
  const submit = () => {
    setLocal("");
    if (!/^-?\d+$/.test(qty.trim())) return setLocal("Quantité entière requise (ex. 5 ou -2).");
    const quantity = parseInt(qty.trim(), 10);
    if (quantity === 0) return setLocal("La quantité ne peut pas être zéro.");
    if (Math.abs(quantity) > 100000) return setLocal("Quantité trop grande.");
    if (reason.trim().length < 3) return setLocal("Motif requis (3 caractères minimum).");
    adjust.mutate({ data: { variantId: row!.id, quantity, reason: reason.trim(), kind, requestId: requestId.current } },
      { onSuccess: () => { requestId.current = crypto.randomUUID(); invalidate(); onClose(); } });
  };
  const n = parseInt(qty, 10);
  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md" dir="ltr">
        <DialogHeader>
          <DialogTitle className="font-serif text-3xl font-normal">Mouvement de stock</DialogTitle>
          <DialogDescription>{row?.productName} · {row?.size} / {row?.color} · disponible : {row?.available}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-4 gap-1.5">
          {(Object.keys(KIND_LABEL) as AdjustmentInputKind[]).map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)} data-testid={`button-kind-${k}`}
              className={`py-2 rounded-md text-xs border transition ${kind === k ? "bg-[#282326] text-[#f6efe9] border-[#282326]" : "border-border hover:border-primary"}`}>{KIND_LABEL[k]}</button>
          ))}
        </div>
        <Field label="Quantité (+ entrée, − sortie)" hint={Number.isFinite(n) && n !== 0 && row ? `Nouveau solde en stock attendu : ${row.onHand + n}` : undefined}>
          <input inputMode="numeric" className={inputCls} value={qty} onChange={(e) => setQty(e.target.value)} placeholder="ex. 5 ou -1" data-testid="input-quantity" />
        </Field>
        <Field label="Motif"><textarea rows={2} maxLength={500} className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="input-reason" /></Field>
        {local && <p className="text-sm text-destructive">{local}</p>}
        <ErrorText e={adjust.error} />
        {adjust.error && <p className="text-xs text-muted-foreground">Vous pouvez réessayer : la même référence sera réutilisée pour éviter un doublon.</p>}
        <div className="flex justify-end gap-2">
          <button className={btnGhost} onClick={onClose}>Annuler</button>
          <button className={btnDark} disabled={adjust.isPending} onClick={submit} data-testid="button-save-adjustment">{adjust.isPending ? "Enregistrement…" : "Enregistrer"}</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- POS placeholder ---------- */

export function PosPage() {
  return (
    <AdminShell title="Caisse" sub="Point de vente en boutique.">
      <div className="max-w-xl bg-card border border-border rounded-md p-10 text-center" data-testid="status-pos-disabled">
        <KeyRound className="w-8 h-8 mx-auto text-secondary" strokeWidth={1.3} />
        <p className="eyebrow mt-5">Phase suivante</p>
        <p className="font-serif text-3xl mt-2">Caisse non activée</p>
        <p className="text-sm text-muted-foreground mt-3">La caisse sera construite sur ce même inventaire partagé. Aucune vente n'est enregistrée pour l'instant.</p>
      </div>
    </AdminShell>
  );
}
