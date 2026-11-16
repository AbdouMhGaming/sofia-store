import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Download, FileUp, Pencil, Plus, Tags, Trash2, X } from "lucide-react";
import {
  useListCategories, useCreateCategory, useUpdateCategory, useDeleteCategory, useExportCatalog, useImportCatalog,
  getListCategoriesQueryKey, getExportCatalogQueryKey, type Category, type CatalogImportResult,
} from "@workspace/api-client-react";
import { useSessionCsrf } from "@/lib/auth";
import { AdminShell, ErrorText, Field, Skel, btnDark, btnGhost, inputCls, useInvalidateCatalog } from "@/pages/admin";

const slugify = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);

/* ---------- Categories ---------- */

export function AdminCategoriesPage() {
  const { session, token } = useSessionCsrf();
  const enabled = !!session.data?.user && !session.data.user.mustChangePassword;
  const q = useListCategories({ query: { queryKey: getListCategoriesQueryKey(), enabled } });
  const qc = useQueryClient();
  const invalidateCatalog = useInvalidateCatalog();
  const create = useCreateCategory({ request: { headers: { "x-csrf-token": token } } });
  const del = useDeleteCategory({ request: { headers: { "x-csrf-token": token, "Content-Type": "application/json" } } });
  const [f, setF] = useState({ slug: "", nameFr: "", nameAr: "" });
  const [slugTouched, setSlugTouched] = useState(false);
  const [local, setLocal] = useState("");
  const [success, setSuccess] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const refresh = (category?: Category, deletedId?: number) => {
    // Reflect the confirmed server response immediately; remote MySQL refetch can
    // take a few seconds. Background invalidation still reconciles other screens.
    qc.setQueryData<Category[]>(getListCategoriesQueryKey(), (previous = []) => {
      const rows = previous.filter(c => c.id !== deletedId && c.id !== category?.id);
      return (category ? [...rows, category] : rows).sort((a, b) => a.nameFr.localeCompare(b.nameFr, "fr"));
    });
    invalidateCatalog();
  };
  const submit = () => {
    setLocal(""); setSuccess("");
    const data = { slug: f.slug.trim(), nameFr: f.nameFr.trim(), nameAr: f.nameAr.trim() };
    if (!data.nameFr || !data.nameAr) return setLocal("Les noms français et arabe sont obligatoires.");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.slug)) return setLocal("Identifiant invalide : minuscules, chiffres et tirets.");
    create.mutate({ data }, { onSuccess: (category) => { setF({ slug: "", nameFr: "", nameAr: "" }); setSlugTouched(false); refresh(category); setSuccess("Catégorie enregistrée."); } });
  };
  return (
    <AdminShell title="Catégories" sub="Rayons du catalogue. Seules les catégories vides peuvent être supprimées.">
      {success && <p role="status" className="mb-4 rounded-md border border-primary/25 bg-primary/5 px-4 py-3 text-sm">{success}</p>}
      <div className="grid lg:grid-cols-[1.4fr_1fr] gap-6 items-start">
        <div className="bg-card border border-border rounded-md">
          {del.error && <div className="p-4 pb-0"><ErrorText e={del.error} /></div>}
          {q.isLoading || !enabled ? <div className="p-4"><Skel h="h-60" /></div> : q.isError ? (
            <div className="p-4"><ErrorText e={q.error} /><button className={`${btnGhost} mt-3`} onClick={() => q.refetch()}>Réessayer</button></div>
          ) : (q.data ?? []).length === 0 ? (
            <div className="py-16 text-center" data-testid="status-categories-empty">
              <Tags className="w-8 h-8 mx-auto text-primary/50" strokeWidth={1.2} />
              <p className="font-serif text-2xl mt-3">Aucune catégorie.</p>
              <p className="text-sm text-muted-foreground mt-1">Créez la première à droite.</p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {(q.data ?? []).map((c) => editId === c.id ? (
                <CategoryEditRow key={c.id} c={c} token={token} onDone={(category) => { setEditId(null); refresh(category); setSuccess("Catégorie modifiée."); }} onCancel={() => setEditId(null)} />
              ) : (
                <li key={c.id} className="flex items-center gap-4 px-5 py-4 hover:bg-[#fbf1f4]/60 transition-colors" data-testid={`row-category-${c.id}`}>
                  <div className="flex-1 min-w-0">
                    <p className="font-serif text-xl">{c.nameFr} <span className="text-muted-foreground font-sans text-base" dir="rtl">· {c.nameAr}</span></p>
                    <p className="text-xs font-mono text-muted-foreground">{c.slug}</p>
                  </div>
                  <button className={btnGhost} onClick={() => setEditId(c.id)} data-testid={`button-edit-category-${c.id}`} aria-label="Modifier"><Pencil className="w-3.5 h-3.5" /></button>
                  <button className={btnGhost} disabled={del.isPending} data-testid={`button-delete-category-${c.id}`} aria-label="Supprimer"
                    onClick={() => { del.reset(); setSuccess(""); if (confirm(`Supprimer la catégorie « ${c.nameFr} » ? Refusé si des produits y sont rattachés.`)) del.mutate({ id: c.id }, { onSuccess: () => { refresh(undefined, c.id); setSuccess("Catégorie vide supprimée."); } }); }}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="bg-[#f7e6ec]/60 border border-primary/15 rounded-md p-6 space-y-4">
          <h2 className="font-serif text-2xl">Nouvelle catégorie</h2>
          <Field label="Nom (FR)"><input className={inputCls} maxLength={150} value={f.nameFr} data-testid="input-category-name-fr"
            onChange={(e) => setF({ ...f, nameFr: e.target.value, slug: slugTouched ? f.slug : slugify(e.target.value) })} /></Field>
          <Field label="Nom (AR)"><input className={inputCls} dir="rtl" maxLength={150} value={f.nameAr} onChange={(e) => setF({ ...f, nameAr: e.target.value })} data-testid="input-category-name-ar" /></Field>
          <Field label="Identifiant URL" hint="Minuscules, chiffres et tirets."><input className={`${inputCls} font-mono`} maxLength={100} value={f.slug} data-testid="input-category-slug"
            onChange={(e) => { setSlugTouched(true); setF({ ...f, slug: e.target.value }); }} /></Field>
          {local && <p className="text-sm text-destructive">{local}</p>}
          <ErrorText e={create.error} />
          <button className={`${btnDark} w-full`} disabled={create.isPending} onClick={submit} data-testid="button-create-category"><Plus className="w-4 h-4" />{create.isPending ? "Création…" : "Créer"}</button>
        </div>
      </div>
    </AdminShell>
  );
}

function CategoryEditRow({ c, token, onDone, onCancel }: { c: Category; token: string; onDone: (category: Category) => void; onCancel: () => void }) {
  const update = useUpdateCategory({ request: { headers: { "x-csrf-token": token } } });
  const [f, setF] = useState({ slug: c.slug, nameFr: c.nameFr, nameAr: c.nameAr });
  const [local, setLocal] = useState("");
  const save = () => {
    setLocal("");
    const data = { slug: f.slug.trim(), nameFr: f.nameFr.trim(), nameAr: f.nameAr.trim() };
    if (!data.nameFr || !data.nameAr) return setLocal("Noms obligatoires.");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.slug)) return setLocal("Identifiant invalide.");
    update.mutate({ id: c.id, data }, { onSuccess: onDone });
  };
  return (
    <li className="px-5 py-4 bg-[#fbf8f5] space-y-3" data-testid={`row-category-edit-${c.id}`}>
      <div className="grid sm:grid-cols-3 gap-3">
        <input className={inputCls} value={f.nameFr} maxLength={150} onChange={(e) => setF({ ...f, nameFr: e.target.value })} data-testid="input-edit-category-name-fr" />
        <input className={inputCls} dir="rtl" value={f.nameAr} maxLength={150} onChange={(e) => setF({ ...f, nameAr: e.target.value })} data-testid="input-edit-category-name-ar" />
        <input className={`${inputCls} font-mono`} value={f.slug} maxLength={100} onChange={(e) => setF({ ...f, slug: e.target.value })} data-testid="input-edit-category-slug" />
      </div>
      {local && <p className="text-sm text-destructive">{local}</p>}
      <ErrorText e={update.error} />
      <div className="flex gap-2 justify-end">
        <button className={btnGhost} onClick={onCancel}><X className="w-3.5 h-3.5" />Annuler</button>
        <button className={btnDark} disabled={update.isPending} onClick={save} data-testid="button-save-category"><Check className="w-4 h-4" />Enregistrer</button>
      </div>
    </li>
  );
}

/* ---------- Import / Export ---------- */

const HEADERS = "productSlug,nameFr,nameAr,descriptionFr,descriptionAr,categorySlug,imagePath,sku,barcode,size,color,priceMinor,costMinor";
const MAX_CHARS = 200_000;

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function AdminImportExportPage() {
  const { session, token } = useSessionCsrf();
  const enabled = !!session.data?.user && !session.data.user.mustChangePassword;
  const exp = useExportCatalog({ query: { queryKey: getExportCatalogQueryKey(), enabled: false, gcTime: 0, retry: false } });
  const imp = useImportCatalog({ request: { headers: { "x-csrf-token": token } } });
  const invalidateCatalog = useInvalidateCatalog();
  const qc = useQueryClient();
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<{ text: string; r: CatalogImportResult } | null>(null);
  const [committed, setCommitted] = useState<CatalogImportResult | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [local, setLocal] = useState("");
  const commitId = useRef(crypto.randomUUID());
  const fileRef = useRef<HTMLInputElement>(null);

  const changeText = (t: string) => {
    setCsv(t); setPreview(null); setConfirmed(false); setCommitted(null); setLocal(""); imp.reset();
    commitId.current = crypto.randomUUID();
  };
  const tooLong = csv.length > MAX_CHARS;
  const firstLine = csv.split(/\r?\n/, 1)[0]?.replace(/^\uFEFF/, "").trim() ?? "";
  const headerOk = firstLine === HEADERS;

  const dryRun = () => {
    setLocal("");
    if (!csv.trim()) return setLocal("Collez ou chargez un fichier CSV.");
    if (tooLong) return setLocal("Fichier trop volumineux (200 000 caractères maximum).");
    const text = csv;
    imp.mutate({ data: { csv: text, dryRun: true, requestId: crypto.randomUUID() } }, { onSuccess: (r) => { setPreview({ text, r }); setConfirmed(false); } });
  };
  const commit = () => {
    if (!preview || preview.text !== csv || !preview.r.valid || !confirmed) return;
    imp.mutate({ data: { csv, dryRun: false, requestId: commitId.current } }, {
      onSuccess: (r) => {
        if (r.committed) {
          setCommitted(r); setPreview(null); setConfirmed(false);
          commitId.current = crypto.randomUUID();
          invalidateCatalog(); qc.invalidateQueries({ queryKey: getListCategoriesQueryKey() });
        } else setPreview({ text: csv, r });
      },
    });
  };
  const canCommit = !!preview && preview.text === csv && preview.r.valid && confirmed && !imp.isPending;

  return (
    <AdminShell title="Import / Export" sub="Catalogue au format CSV. Le stock n'est jamais importé.">
      <div className="grid lg:grid-cols-[1fr_1.6fr] gap-6 items-start">
        <div className="space-y-6">
          <section className="bg-[#282326] text-[#f6efe9] rounded-md p-6">
            <p className="eyebrow !text-[#e9a77f]">Export</p>
            <h2 className="font-serif text-3xl mt-2">Catalogue complet</h2>
            <p className="text-sm opacity-75 mt-2">Produits et déclinaisons au format CSV. Les cellules sensibles sont protégées par le serveur.</p>
            <button className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-primary text-primary-foreground text-sm hover:bg-[#f6efe9] hover:text-[#282326] transition-colors disabled:opacity-50"
              disabled={!enabled || exp.isFetching} data-testid="button-export-catalog"
              onClick={async () => {
                const r = await exp.refetch();
                if (r.data !== undefined) download(`sofia-catalogue-${new Date().toISOString().slice(0, 10)}.csv`, String(r.data));
              }}><Download className="w-4 h-4" />{exp.isFetching ? "Préparation…" : "Télécharger le CSV"}</button>
            {exp.error && <p className="text-sm text-[#ffb3c6] mt-3">{String((exp.error as Error).message ?? exp.error)}</p>}
          </section>
          <section className="bg-card border border-border rounded-md p-6 space-y-3">
            <h2 className="font-serif text-2xl">Format d'import</h2>
            <p className="text-sm text-muted-foreground">En-têtes exacts, dans cet ordre :</p>
            <code className="block text-[11px] font-mono bg-muted rounded-md p-3 break-all" data-testid="text-import-headers">{HEADERS}</code>
            <ul className="text-sm space-y-1.5 text-foreground/80 list-disc ps-5">
              <li>Nouveaux produits uniquement, 100 déclinaisons maximum par import.</li>
              <li>Plusieurs lignes peuvent décrire le même produit si ses informations sont identiques.</li>
              <li>Prix et coût en centimes entiers (4500 DA = 450000).</li>
              <li>Descriptions et imagePath facultatifs.</li>
            </ul>
            <div className="flex gap-3 rounded-md border border-secondary/40 bg-[#fbf1ea] p-3 text-sm">
              <AlertTriangle className="w-4 h-4 text-secondary shrink-0 mt-0.5" />
              Aucune quantité de stock n'est importée. Enregistrez les réceptions ensuite depuis l'Inventaire.
            </div>
            <button className={btnGhost} onClick={() => download("sofia-modele-import.csv", HEADERS + "\n")} data-testid="button-download-template"><Download className="w-3.5 h-3.5" />Modèle vide</button>
          </section>
        </div>

        <section className="bg-card border border-border rounded-md p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><p className="eyebrow">Import</p><h2 className="font-serif text-3xl mt-1">Aperçu puis validation</h2></div>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" data-testid="input-import-file"
              onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; setFileName(f.name); changeText(await f.text()); }} />
            <button className={btnGhost} onClick={() => fileRef.current?.click()} data-testid="button-choose-csv"><FileUp className="w-3.5 h-3.5" />Charger un fichier</button>
          </div>
          {fileName && <p className="text-xs text-muted-foreground">Fichier : {fileName}</p>}
          <textarea rows={10} spellCheck={false} className={`${inputCls} font-mono text-xs`} placeholder={HEADERS} value={csv}
            onChange={(e) => { setFileName(""); changeText(e.target.value); }} data-testid="input-import-csv" />
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <span className={tooLong ? "text-destructive" : "text-muted-foreground"} data-testid="text-csv-length">{csv.length.toLocaleString("fr-FR")} / 200 000 caractères</span>
            {csv.trim() && <span className={headerOk ? "text-primary" : "text-secondary"}>{headerOk ? "En-têtes conformes" : "En-têtes différents du modèle"}</span>}
          </div>
          {local && <p className="text-sm text-destructive">{local}</p>}
          <ErrorText e={imp.error} />
          {imp.error && preview && <p className="text-xs text-muted-foreground">Vous pouvez réessayer la validation : la même référence sera réutilisée.</p>}
          <button className={btnDark} disabled={imp.isPending || !csv.trim() || tooLong} onClick={dryRun} data-testid="button-dry-run">{imp.isPending && !preview ? "Analyse…" : "Analyser (sans enregistrer)"}</button>

          {preview && (
            <div className="rounded-md border border-border overflow-hidden rise" data-testid="panel-import-preview">
              <div className={`px-4 py-3 flex flex-wrap gap-6 ${preview.r.valid ? "bg-[#f7e6ec]/60" : "bg-destructive/5"}`}>
                <div><p className="text-xs uppercase tracking-wide text-muted-foreground">Produits</p><p className="font-serif text-3xl" data-testid="text-preview-products">{preview.r.products}</p></div>
                <div><p className="text-xs uppercase tracking-wide text-muted-foreground">Déclinaisons</p><p className="font-serif text-3xl" data-testid="text-preview-variants">{preview.r.variants}</p></div>
                <div className="ms-auto self-center text-sm font-medium" data-testid="status-preview-valid">{preview.r.valid ? "Prêt à importer" : `${preview.r.errors.length} erreur(s)`}</div>
              </div>
              {preview.r.errors.length > 0 && <ul className="px-4 py-3 space-y-1 text-sm text-destructive max-h-56 overflow-y-auto border-t border-border">{preview.r.errors.map((e, i) => <li key={i} data-testid={`text-import-error-${i}`}>{e}</li>)}</ul>}
              {preview.r.warnings.length > 0 && <ul className="px-4 py-3 space-y-1 text-sm text-secondary max-h-40 overflow-y-auto border-t border-border">{preview.r.warnings.map((e, i) => <li key={i}>{e}</li>)}</ul>}
              {preview.r.valid && (
                <div className="px-4 py-4 border-t border-border space-y-3">
                  <label className="flex items-start gap-3 text-sm cursor-pointer">
                    <input type="checkbox" className="accent-[#F04F94] w-4 h-4 mt-0.5" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} data-testid="checkbox-confirm-import" />
                    Je confirme la création de {preview.r.products} produit(s) et {preview.r.variants} déclinaison(s), avec un stock à zéro.
                  </label>
                  <button className={btnDark} disabled={!canCommit} onClick={commit} data-testid="button-commit-import">{imp.isPending ? "Import…" : "Importer définitivement"}</button>
                </div>
              )}
            </div>
          )}
          {committed && (
            <div className="rounded-md border border-primary/30 bg-[#f7e6ec]/60 p-4 text-sm" data-testid="status-import-committed">
              Import enregistré : {committed.products} produit(s) et {committed.variants} déclinaison(s) ont été sauvegardés. Statut catalogue : Aperçu. Aucun stock ajouté.
            </div>
          )}
        </section>
      </div>
    </AdminShell>
  );
}
