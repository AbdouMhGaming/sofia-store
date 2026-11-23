import { useMemo, useState, type ReactNode } from "react";
import { Redirect } from "wouter";
import { AlertTriangle, Download, Landmark, RefreshCw, Truck, Wallet } from "lucide-react";
import {
  useGetRetailReport, getGetRetailReportQueryKey, useExportRetailReport, getExportRetailReportQueryKey,
  type GetRetailReportParams, type RetailReport, type ReportBucket, type ReportMerchandiseGroup,
  type GetRetailReportChannel, type GetRetailReportGroupBy,
} from "@workspace/api-client-react";
import { useSessionCsrf } from "@/lib/auth";
import { formatDA } from "@/lib/util";
import { AdminShell } from "@/pages/admin";
import { inputCls, btnDark, btnGhost, Field, ErrorText, Skel } from "@/components/admin/shell-primitives";

const TZ = "Africa/Algiers";
const CHANNELS: { v: GetRetailReportChannel; l: string }[] = [
  { v: "ALL", l: "Tous" }, { v: "POS", l: "Boutique" }, { v: "ONLINE", l: "En ligne" }, { v: "PICKUP", l: "Retrait" }, { v: "DELIVERY", l: "Livraison" },
];

function todayAlgiers() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function defaults(): GetRetailReportParams {
  const t = todayAlgiers();
  return { from: `${t.slice(0, 8)}01`, to: t, groupBy: "DAY", channel: "ALL" };
}
const RE = /^\d{4}-\d{2}-\d{2}$/;
function validDate(s: string) {
  if (!RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
function validate(p: GetRetailReportParams): string {
  if (!validDate(p.from) || !validDate(p.to)) return "Dates invalides (format AAAA-MM-JJ).";
  if (p.from < "2000-01-01") return "Choisissez une date à partir du 01/01/2000.";
  if (p.from > p.to) return "La date de début doit précéder la date de fin.";
  if (p.to > todayAlgiers()) return "La date de fin ne peut pas dépasser aujourd'hui (heure d'Alger).";
  const days = (Date.parse(`${p.to}T00:00:00Z`) - Date.parse(`${p.from}T00:00:00Z`)) / 86_400_000 + 1;
  if (days > 366) return "La période ne peut pas dépasser 366 jours.";
  return "";
}
const same = (a: GetRetailReportParams, b: GetRetailReportParams) =>
  a.from === b.from && a.to === b.to && a.groupBy === b.groupBy && a.channel === b.channel;

/** Signed amount: formatDA loses the sign for values between -1 and 0 DA, so format the magnitude. */
export function money(minor: number) {
  return minor < 0 ? `−${formatDA(-minor)}` : formatDA(minor);
}
const neg = (n: number) => (n < 0 ? "text-destructive" : "");
const n = (v: number) => v.toLocaleString("fr-FR");

function isEmpty(r: RetailReport) {
  const s = r.summary, a = s.activity;
  const vals = [s.salesCount, ...Object.values(a), ...Object.values(s.money), s.estimatedMarginMinor];
  return vals.every((v) => v === 0) && r.products.length === 0 && r.outstanding.count === 0 && r.outstanding.grossMinor === 0;
}

export function AdminReportsPage() {
  const { session } = useSessionCsrf();
  const user = session.data?.user;
  const owner = !!user && user.role === "STORE_OWNER" && !user.mustChangePassword;
  const [draft, setDraft] = useState<GetRetailReportParams>(defaults);
  const [applied, setApplied] = useState<GetRetailReportParams>(defaults);
  const [local, setLocal] = useState("");
  const [exportErr, setExportErr] = useState("");

  const q = useGetRetailReport(applied, { query: { queryKey: getGetRetailReportQueryKey(applied), enabled: owner } });
  const r = q.data;
  const exportParams = { ...applied, expectedFingerprint: r?.fingerprint };
  const ex = useExportRetailReport(exportParams, { query: { enabled: false, queryKey: getExportRetailReportQueryKey(exportParams) } });
  const matches = !!r && r.from === applied.from && r.to === applied.to && r.groupBy === applied.groupBy && r.channel === applied.channel;
  const dirty = !same(draft, applied);
  const canExport = owner && matches && !q.isFetching && !q.isError && !dirty && !ex.isFetching;

  if (session.data && user && user.role !== "STORE_OWNER" && !user.mustChangePassword) return <Redirect to={user.role === "CASHIER" ? "/pos" : "/admin"} />;

  const apply = () => {
    const err = validate(draft);
    setLocal(err);
    if (!err) {
      setExportErr("");
      if (same(draft, applied)) void q.refetch();
      else setApplied({ ...draft });
    }
  };
  const doExport = async () => {
    setExportErr("");
    const res = await ex.refetch();
    if (res.error || typeof res.data !== "string") {
      setExportErr(res.error?.status === 409 ? "Les chiffres ont changé. Cliquez sur Appliquer pour actualiser, puis relancez l'export." : "Export impossible. Réessayez.");
      return;
    }
    const blob = new Blob([res.data.startsWith("\uFEFF") ? res.data : "\uFEFF" + res.data], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `sofia-rapport_${applied.from}_${applied.to}_${applied.channel}_${applied.groupBy}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <AdminShell title="Rapports" sub="Chiffres réels, vérifiables, par période et par canal. Réservé à la propriétaire."
      actions={owner && <button className={btnDark} disabled={!canExport} onClick={doExport} data-testid="button-export-report"
        title={dirty ? "Appliquez les filtres avant d'exporter" : undefined}>
        <Download className="w-4 h-4" />{ex.isFetching ? "Export…" : "Exporter CSV"}</button>}>
      {!owner ? <Skel h="h-80" /> : (
        <div className="space-y-8 min-w-0">
          <form className="bg-card border border-border rounded-md p-4 grid grid-cols-2 md:grid-cols-[1fr_1fr_auto_auto] gap-3 items-end"
            onSubmit={(e) => { e.preventDefault(); apply(); }}>
            <Field label="Du"><input type="date" className={inputCls} value={draft.from} min="2000-01-01" max={todayAlgiers()} onChange={(e) => setDraft({ ...draft, from: e.target.value })} data-testid="input-report-from" /></Field>
            <Field label="Au"><input type="date" className={inputCls} value={draft.to} min="2000-01-01" max={todayAlgiers()} onChange={(e) => setDraft({ ...draft, to: e.target.value })} data-testid="input-report-to" /></Field>
            <Field label="Regrouper">
              <select className={inputCls} value={draft.groupBy} onChange={(e) => setDraft({ ...draft, groupBy: e.target.value as GetRetailReportGroupBy })} data-testid="select-report-group">
                <option value="DAY">Par jour</option><option value="MONTH">Par mois</option>
              </select>
            </Field>
            <button className={`${btnDark} col-span-2 md:col-span-1`} data-testid="button-apply-report"><RefreshCw className="w-4 h-4" />Appliquer</button>
            <div className="col-span-2 md:col-span-4 flex flex-wrap gap-2">
              {CHANNELS.map((c) => (
                <button type="button" key={c.v} onClick={() => setDraft({ ...draft, channel: c.v })} data-testid={`button-channel-${c.v}`}
                  className={`px-3.5 py-1.5 rounded-full text-xs border transition ${draft.channel === c.v ? "bg-[#282326] text-[#f6efe9] border-[#282326]" : "border-border hover:border-primary"}`}>{c.l}</button>
              ))}
            </div>
            {local && <p className="col-span-2 md:col-span-4 text-sm text-destructive" data-testid="text-report-validation">{local}</p>}
            {dirty && !local && <p className="col-span-2 md:col-span-4 text-xs text-secondary" data-testid="status-report-dirty">Filtres modifiés : le rapport affiché et l'export correspondent encore aux filtres précédents. Cliquez sur Appliquer.</p>}
          </form>
          {exportErr && <p className="text-sm text-destructive">{exportErr}</p>}

          {q.isLoading ? <div className="space-y-4"><Skel h="h-32" /><Skel h="h-64" /></div>
            : q.isError ? <div><ErrorText e={q.error} /><button className={`${btnGhost} mt-3`} onClick={() => q.refetch()} data-testid="button-retry-report">Réessayer</button></div>
            : r && <ReportBody r={r} />}
        </div>
      )}
    </AdminShell>
  );
}

function ReportBody({ r }: { r: RetailReport }) {
  const s = r.summary;
  const empty = isEmpty(r);
  const asOf = new Date(r.outstanding.asOf).toLocaleString("fr-FR", { timeZone: TZ });
  return (
    <div className="space-y-8" data-testid="report-body">
      <p className="text-xs text-muted-foreground" data-testid="text-report-scope">
        {r.from} au {r.to} · {CHANNELS.find((c) => c.v === r.channel)?.l} · {r.groupBy === "DAY" ? "par jour" : "par mois"} · fuseau {r.timezone} · généré le {new Date(r.generatedAt).toLocaleString("fr-FR", { timeZone: TZ })}
      </p>

      {r.warnings.length > 0 && (
        <div className="rounded-md border border-secondary/40 bg-[#fbf1ea] p-4 text-sm space-y-1" data-testid="list-report-warnings">
          {r.warnings.map((w, i) => <p key={i} className="flex gap-2"><AlertTriangle className="w-4 h-4 text-secondary shrink-0 mt-0.5" />{w}</p>)}
        </div>
      )}

      {empty ? (
        <div className="border border-dashed border-border rounded-md py-14 text-center" data-testid="status-report-empty">
          <p className="font-serif text-2xl">Aucun mouvement sur cette période.</p>
          <p className="text-sm text-muted-foreground mt-1">Ni vente, ni retour, ni encaissement, ni solde transporteur.</p>
        </div>
      ) : (
        <>
          {/* Commercial activity vs money actually received: kept visually distinct. */}
          <div className="grid lg:grid-cols-2 gap-6">
            <section className="bg-card border border-border rounded-md overflow-hidden">
              <header className="px-5 py-3 border-b border-border"><p className="eyebrow">Activité commerciale</p><p className="text-xs text-muted-foreground mt-1">Date de vente, livraison ou retrait ; retours à la date de retour physique.</p></header>
              <dl className="grid grid-cols-2 gap-px bg-border">
                <Stat label="Chiffre net" v={s.activity.netMinor} big testid="stat-net" />
                <Stat label="Marge marchandise" v={s.activity.marginMinor} big testid="stat-margin" />
                <Stat label="Brut" v={s.activity.grossMinor} />
                <Stat label="Remises" v={-s.activity.discountMinor} />
                <Stat label="Retours" v={-s.activity.returnsMinor} />
                <Stat label="Coût net" v={s.activity.netCostMinor} />
                <Stat label="Coût des ventes" v={s.activity.costSoldMinor} />
                <Stat label="Coût repris en stock" v={-s.activity.costRecoveredMinor} />
                <Stat label="Ventes" raw={n(s.salesCount)} />
                <Stat label="Unités vendues / retournées" raw={`${n(s.activity.unitsSold)} / ${n(s.activity.unitsReturned)}`} />
              </dl>
              {s.activity.damagedUnfulfilledMinor !== 0 && <p className="px-5 py-3 text-xs text-muted-foreground border-t border-border">
                Dont pertes d'envois jamais livrés : {money(s.activity.damagedUnfulfilledMinor)}, déjà comprises dans le coût net.
              </p>}
            </section>
            <section className="bg-card border border-border rounded-md overflow-hidden">
              <header className="px-5 py-3 border-b border-border"><p className="eyebrow">Argent réellement reçu</p><p className="text-xs text-muted-foreground mt-1">Date d'encaissement en boutique. La banque n'entre jamais dans le tiroir.</p></header>
              <dl className="grid grid-cols-2 gap-px bg-border">
                <Stat label="Net encaissé" v={s.money.netInMinor} big testid="stat-net-in" />
                <Stat label="Frais nets (livraison)" v={s.money.netFeesMinor} big />
                <Stat label="Espèces entrées" v={s.money.cashInMinor} icon={<Wallet className="w-3.5 h-3.5" />} />
                <Stat label="Espèces sorties" v={-s.money.cashOutMinor} icon={<Wallet className="w-3.5 h-3.5" />} />
                <Stat label="Banque entrées" v={s.money.bankInMinor} icon={<Landmark className="w-3.5 h-3.5" />} />
                <Stat label="Banque sorties" v={-s.money.bankOutMinor} icon={<Landmark className="w-3.5 h-3.5" />} />
                <Stat label="Remboursements marchandise" v={-s.money.merchandiseRefundsMinor} />
                <Stat label="Frais transporteur" v={-s.money.carrierFeesMinor} />
                <Stat label="Livraison encaissée" v={s.money.shippingInMinor} />
                <Stat label="Livraison remboursée" v={-s.money.shippingRefundsMinor} />
              </dl>
            </section>
          </div>

          <div className="grid md:grid-cols-[1.3fr_1fr] gap-6">
            <div className="bg-[#282326] text-[#f6efe9] rounded-md p-5" data-testid="card-estimated-margin">
              <p className="text-xs uppercase tracking-wide opacity-70">Marge globale estimée</p>
              <p className={`font-serif text-4xl mt-2 ${s.estimatedMarginMinor < 0 ? "text-[#f4a3a8]" : ""}`}>{money(s.estimatedMarginMinor)}</p>
              <p className="text-xs opacity-70 mt-2">Marge marchandise {money(s.activity.marginMinor)} + frais nets {money(s.money.netFeesMinor)}. Estimation, pas un bénéfice net : dates commerciales et d'encaissement diffèrent ; impôts et charges non inclus.</p>
            </div>
            <div className="border-2 border-dashed border-secondary/50 rounded-md p-5 bg-[#fbf1ea]/60" data-testid="card-outstanding">
              <p className="text-xs uppercase tracking-wide text-secondary flex items-center gap-2"><Truck className="w-4 h-4" />Solde chez les transporteurs</p>
              <p className="font-serif text-4xl mt-2">{money(r.outstanding.grossMinor)}</p>
              <p className="text-xs text-muted-foreground mt-2">{n(r.outstanding.count)} commande(s) encaissée(s) par le livreur, non reversée(s), au {asOf}. Solde à date, hors totaux de la période. Ce n'est pas de l'argent en caisse ni en banque.</p>
            </div>
          </div>

          <BucketTable title={r.groupBy === "DAY" ? "Par jour" : "Par mois"} rows={r.periods} total={s} testid="table-periods" />
          <BucketTable title="Par canal" rows={r.channels} total={s} testid="table-channels" />
          <div className="grid xl:grid-cols-2 gap-6">
            <MerchTable title="Par produit" note="Noms actuels des produits." rows={r.products} testid="table-products" />
            <MerchTable title="Par catégorie" note="Classement actuel des catégories, pas celui au moment de la vente." rows={r.categories} testid="table-categories" />
          </div>
          <p className="text-xs text-muted-foreground">Les marges produit et catégorie portent sur la marchandise seule ; frais de livraison et transporteur restent au niveau commande (frais nets).</p>
        </>
      )}

      {r.definitions.length > 0 && (
        <details className="bg-card border border-border rounded-md p-5" data-testid="list-report-definitions">
          <summary className="cursor-pointer font-serif text-2xl">Définitions et base de calcul</summary>
          <dl className="mt-4 grid md:grid-cols-2 gap-x-8 gap-y-3 text-sm">
            {r.definitions.map((d) => <div key={d.key}><dt className="font-medium">{d.label}</dt><dd className="text-muted-foreground">{d.explanation}</dd></div>)}
          </dl>
        </details>
      )}
    </div>
  );
}

function Stat({ label, v, raw, big, icon, testid }: { label: string; v?: number; raw?: string; big?: boolean; icon?: ReactNode; testid?: string }) {
  return (
    <div className="bg-card px-4 py-3 min-w-0" data-testid={testid}>
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">{icon}{label}</dt>
      <dd className={`${big ? "font-serif text-2xl md:text-3xl" : "text-sm font-medium"} mt-1 tabular-nums break-words ${v !== undefined ? neg(v) : ""}`}>{raw ?? money(v ?? 0)}</dd>
    </div>
  );
}

const th = "px-3 py-2 text-[11px] uppercase tracking-wide text-muted-foreground font-normal text-right whitespace-nowrap";
const td = (v: number) => `px-3 py-2 text-right tabular-nums whitespace-nowrap ${neg(v)}`;

function BucketTable({ title, rows, total, testid }: { title: string; rows: ReportBucket[]; total: ReportBucket; testid: string }) {
  const cols = useMemo(() => [
    ["Ventes", (b: ReportBucket) => b.salesCount, true],
    ["Net", (b: ReportBucket) => b.activity.netMinor],
    ["Marge march.", (b: ReportBucket) => b.activity.marginMinor],
    ["Espèces nettes", (b: ReportBucket) => b.money.cashInMinor - b.money.cashOutMinor],
    ["Banque nette", (b: ReportBucket) => b.money.bankInMinor - b.money.bankOutMinor],
    ["Net encaissé", (b: ReportBucket) => b.money.netInMinor],
    ["Frais nets", (b: ReportBucket) => b.money.netFeesMinor],
    ["Marge estimée", (b: ReportBucket) => b.estimatedMarginMinor],
  ] as const, []);
  return (
    <section className="bg-card border border-border rounded-md min-w-0" data-testid={testid}>
      <h2 className="font-serif text-2xl px-5 pt-4 pb-2">{title}</h2>
      {rows.length === 0 ? <p className="px-5 pb-5 text-sm text-muted-foreground">Aucune ligne.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border"><th className={`${th} text-left`}>Libellé</th>{cols.map(([l]) => <th key={l} className={th}>{l}</th>)}</tr></thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.key} className="border-b border-border/60 hover:bg-muted/40" data-testid={`row-${testid}-${b.key}`}>
                  <td className="px-3 py-2 whitespace-nowrap">{b.label}</td>
                  {cols.map(([l, f, count]) => { const v = f(b); return <td key={l} className={td(v)}>{count ? n(v) : money(v)}</td>; })}
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="bg-muted/50 font-medium">
              <td className="px-3 py-2">Total</td>
              {cols.map(([l, f, count]) => { const v = f(total); return <td key={l} className={td(v)}>{count ? n(v) : money(v)}</td>; })}
            </tr></tfoot>
          </table>
        </div>
      )}
    </section>
  );
}

function MerchTable({ title, note, rows, testid }: { title: string; note: string; rows: ReportMerchandiseGroup[]; testid: string }) {
  return (
    <section className="bg-card border border-border rounded-md min-w-0" data-testid={testid}>
      <div className="px-5 pt-4 pb-2"><h2 className="font-serif text-2xl">{title}</h2><p className="text-xs text-muted-foreground">{note}</p></div>
      {rows.length === 0 ? <p className="px-5 pb-5 text-sm text-muted-foreground">Aucune ligne.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border">
              <th className={`${th} text-left`}>Libellé</th><th className={th}>Vendu</th><th className={th}>Retourné</th><th className={th}>Net</th><th className={th}>Coût net</th><th className={th}>Pertes</th><th className={th}>Marge</th>
            </tr></thead>
            <tbody>
              {rows.map((g) => (
                <tr key={g.key} className="border-b border-border/60 hover:bg-muted/40" data-testid={`row-${testid}-${g.key}`}>
                  <td className="px-3 py-2 max-w-[14rem] truncate" title={g.label}>{g.label}</td>
                  <td className={td(g.activity.unitsSold)}>{n(g.activity.unitsSold)}</td>
                  <td className={td(0)}>{n(g.activity.unitsReturned)}</td>
                  <td className={td(g.activity.netMinor)}>{money(g.activity.netMinor)}</td>
                  <td className={td(g.activity.netCostMinor)}>{money(g.activity.netCostMinor)}</td>
                  <td className={td(0)}>{money(g.activity.damagedUnfulfilledMinor)}</td>
                  <td className={td(g.activity.marginMinor)}>{money(g.activity.marginMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
