import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Lock, Search } from "lucide-react";
import {
  useGetAdminCheckoutSettings, useSaveAdminCheckoutSettings, useListAdminOrders, useGetAdminOrder, useCancelAdminOrder,
  getGetAdminCheckoutSettingsQueryKey, getGetCheckoutConfigQueryKey, getListAdminOrdersQueryKey, getGetAdminOrderQueryKey,
  type CheckoutSettings, type ListAdminOrdersParams, type ListAdminOrdersStatus,
} from "@workspace/api-client-react";
import { useSessionCsrf } from "@/lib/auth";
import { daToMinor, formatDA } from "@/lib/util";
import { fmtDate, fmtDateLong } from "@/lib/pos";
import { useInvalidateCommerce } from "@/lib/shop";
import { AdminShell } from "@/pages/admin";
import { inputCls, btnDark, btnGhost, Field, ErrorText, Skel } from "@/components/admin/shell-primitives";

const minorToInput = (m: number | null) => (m === null ? "" : (m / 100).toFixed(2).replace(/\.00$/, ""));

const ZF = ["homeFee", "deskFee", "homeMin", "homeMax", "deskMin", "deskMax"] as const;
type ZoneDraft = { code: string; nameFr: string; nameAr: string; enabled: boolean } & Record<typeof ZF[number], string>;
const numIn = (n: number | null) => (n === null ? "" : String(n));
type Draft = Omit<CheckoutSettings, "zones" | "pickupFeeMinor" | "reservationMinutes"> & { pickupFee: string; reservation: string; zones: ZoneDraft[] };

function toDraft(c: CheckoutSettings): Draft {
  return {
    enabled: c.enabled, deliveryEnabled: c.deliveryEnabled, pickupEnabled: c.pickupEnabled,
    pickupAddressFr: c.pickupAddressFr, pickupAddressAr: c.pickupAddressAr, policyFr: c.policyFr, policyAr: c.policyAr,
    pickupFee: minorToInput(c.pickupFeeMinor), reservation: c.reservationMinutes === null ? "" : String(c.reservationMinutes),
    zones: c.zones.map((z) => ({ code: z.code, nameFr: z.nameFr, nameAr: z.nameAr, enabled: z.enabled, homeFee: minorToInput(z.homeFeeMinor), deskFee: minorToInput(z.deskFeeMinor), homeMin: numIn(z.homeMinDays), homeMax: numIn(z.homeMaxDays), deskMin: numIn(z.deskMinDays), deskMax: numIn(z.deskMaxDays) })),
  };
}

/** Converts the draft to exact centimes; returns error text instead of guessing. */
function fromDraft(d: Draft): CheckoutSettings | string {
  let pickupFeeMinor: number | null = null;
  if (d.pickupFee.trim()) { pickupFeeMinor = daToMinor(d.pickupFee); if (pickupFeeMinor === null || pickupFeeMinor > 1_000_000_000) return "Frais de retrait invalides."; }
  let reservationMinutes: number | null = null;
  if (d.reservation.trim()) {
    if (!/^\d+$/.test(d.reservation.trim())) return "Durée de réservation invalide.";
    reservationMinutes = Number(d.reservation.trim());
    if (reservationMinutes < 15 || reservationMinutes > 10080) return "La réservation doit être entre 15 et 10080 minutes.";
  }
  const zones = [];
  for (const z of d.zones) {
    const label = `${z.code} ${z.nameFr}`;
    const fee = (v: string) => { if (!v.trim()) return null; const m = daToMinor(v); return m === null || m > 1_000_000_000 ? NaN : m; };
    const day = (v: string) => { if (!v.trim()) return null; return /^\d+$/.test(v.trim()) && +v >= 1 && +v <= 60 ? +v : NaN; };
    const homeFeeMinor = fee(z.homeFee), deskFeeMinor = fee(z.deskFee);
    const homeMinDays = day(z.homeMin), homeMaxDays = day(z.homeMax), deskMinDays = day(z.deskMin), deskMaxDays = day(z.deskMax);
    if ([homeFeeMinor, deskFeeMinor].some((x) => Number.isNaN(x))) return `${label} : frais invalides.`;
    if ([homeMinDays, homeMaxDays, deskMinDays, deskMaxDays].some((x) => Number.isNaN(x))) return `${label} : délais entre 1 et 60 jours (entiers).`;
    if (homeFeeMinor !== null && (homeMinDays === null || homeMaxDays === null || homeMinDays > homeMaxDays)) return `${label} : délai domicile min/max requis (min <= max).`;
    if (deskFeeMinor !== null && (deskMinDays === null || deskMaxDays === null || deskMinDays > deskMaxDays)) return `${label} : délai bureau min/max requis (min <= max).`;
    if (z.enabled && homeFeeMinor === null && deskFeeMinor === null) return `${label} : activée sans aucun frais configuré.`;
    zones.push({ code: z.code, nameFr: z.nameFr, nameAr: z.nameAr, enabled: z.enabled, homeFeeMinor, deskFeeMinor, homeMinDays, homeMaxDays, deskMinDays, deskMaxDays });
  }
  return {
    enabled: d.enabled, deliveryEnabled: d.deliveryEnabled, pickupEnabled: d.pickupEnabled,
    pickupAddressFr: d.pickupAddressFr, pickupAddressAr: d.pickupAddressAr, policyFr: d.policyFr, policyAr: d.policyAr,
    pickupFeeMinor, reservationMinutes, zones,
  };
}

function Toggle({ on, onChange, label, disabled, testId }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; testId: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label || `Wilaya ${testId.split("-").at(-1)}`} disabled={disabled} onClick={() => onChange(!on)} data-testid={testId}
      className="flex items-center gap-3 text-sm disabled:opacity-60">
      <span className={`w-10 h-6 rounded-full p-0.5 transition-colors ${on ? "bg-primary" : "bg-muted-foreground/30"}`}>
        <span className={`block w-5 h-5 rounded-full bg-background transition-transform ${on ? "translate-x-4" : ""}`} />
      </span>{label}
    </button>
  );
}

export function AdminCheckoutSettingsPage() {
  const { session, request } = useSessionCsrf();
  const owner = session.data?.user?.role === "STORE_OWNER";
  const qc = useQueryClient();
  const invalidate = useInvalidateCommerce();
  const q = useGetAdminCheckoutSettings({ query: { queryKey: getGetAdminCheckoutSettingsQueryKey(), enabled: !!session.data?.user } });
  const save = useSaveAdminCheckoutSettings({ request });
  const [d, setD] = useState<Draft | null>(null);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);
  const inited = useRef(false);
  useEffect(() => { if (q.data && !inited.current) { inited.current = true; setD(toDraft(q.data)); } }, [q.data]);
  const set = (p: Partial<Draft>) => { setD((x) => (x ? { ...x, ...p } : x)); setOk(false); };
  const setZone = (i: number, p: Partial<ZoneDraft>) => d && set({ zones: d.zones.map((z, j) => (j === i ? { ...z, ...p } : z)) });
  const ro = !owner;

  const submit = () => {
    if (!d || ro) return;
    setErr(""); setOk(false);
    const body = fromDraft(d);
    if (typeof body === "string") { setErr(body); return; }
    save.mutate({ data: body }, {
      onSuccess: (saved) => {
        qc.setQueryData(getGetAdminCheckoutSettingsQueryKey(), saved);
        qc.invalidateQueries({ queryKey: getGetCheckoutConfigQueryKey() });
        invalidate();
        setD(toDraft(saved)); setOk(true);
      },
    });
  };

  return (
    <AdminShell title="Vente en ligne" sub="Réglages de la commande en ligne. Rien n'est actif tant que vous ne l'activez pas explicitement."
      actions={owner ? <button className={btnDark} disabled={!d || save.isPending} onClick={submit} data-testid="button-save-settings">{save.isPending ? "Enregistrement..." : "Enregistrer"}</button> : undefined}>
      {ro && <p className="mb-6 flex items-center gap-2 text-sm bg-[#fbf1ea] border border-[#d98c62]/30 rounded-md px-4 py-3" data-testid="status-readonly"><Lock className="w-4 h-4" />Lecture seule : seule la propriétaire peut modifier ces réglages.</p>}
      {q.isLoading || (!d && !q.isError) ? <Skel h="h-96" /> : q.isError ? (
        <div className="space-y-3"><ErrorText e={q.error} /><button className={btnGhost} onClick={() => q.refetch()}>Réessayer</button></div>
      ) : d && (
        <fieldset disabled={ro || save.isPending} className="space-y-8 max-w-4xl">
          <ErrorText e={save.error} />
          {err && <p className="text-sm text-destructive" data-testid="text-settings-error">{err}</p>}
          {ok && <p className="text-sm text-secondary" data-testid="status-saved">Réglages enregistrés.</p>}
          <section className={`rounded-md border p-6 ${d.enabled ? "border-primary bg-[#f7e6ec]/50" : "border-border bg-card"}`}>
            <Toggle on={d.enabled} onChange={(v) => set({ enabled: v })} label={d.enabled ? "Commande en ligne ACTIVÉE" : "Commande en ligne désactivée"} disabled={ro} testId="toggle-enabled" />
            <p className="text-xs text-muted-foreground mt-2">Le serveur refuse l'activation si un mode activé n'est pas entièrement configuré (adresse, frais, réservation, conditions bilingues).</p>
          </section>
          <section className="rounded-md border border-border bg-card p-6 grid md:grid-cols-2 gap-5">
            <h2 className="font-serif text-2xl md:col-span-2">Général</h2>
            <Field label="Durée de réservation (minutes)" hint="15 à 10080. Vide = non configuré."><input className={inputCls} inputMode="numeric" value={d.reservation} onChange={(e) => set({ reservation: e.target.value })} data-testid="input-reservation" /></Field>
            <div />
            <Field label="Conditions (FR)"><textarea className={`${inputCls} min-h-32`} maxLength={3000} value={d.policyFr} onChange={(e) => set({ policyFr: e.target.value })} data-testid="input-policy-fr" /></Field>
            <Field label="Conditions (AR)"><textarea dir="rtl" className={`${inputCls} min-h-32`} maxLength={3000} value={d.policyAr} onChange={(e) => set({ policyAr: e.target.value })} data-testid="input-policy-ar" /></Field>
          </section>
          <section className="rounded-md border border-border bg-card p-6 grid md:grid-cols-2 gap-5">
            <div className="md:col-span-2 flex justify-between items-center"><h2 className="font-serif text-2xl">Retrait en boutique</h2><Toggle on={d.pickupEnabled} onChange={(v) => set({ pickupEnabled: v })} label={d.pickupEnabled ? "Activé" : "Désactivé"} disabled={ro} testId="toggle-pickup" /></div>
            <Field label="Adresse de retrait (FR)"><textarea className={inputCls} maxLength={500} value={d.pickupAddressFr} onChange={(e) => set({ pickupAddressFr: e.target.value })} data-testid="input-pickup-fr" /></Field>
            <Field label="Adresse de retrait (AR)"><textarea dir="rtl" className={inputCls} maxLength={500} value={d.pickupAddressAr} onChange={(e) => set({ pickupAddressAr: e.target.value })} data-testid="input-pickup-ar" /></Field>
            <Field label="Frais de retrait (DA)" hint="Montant exact. Vide = non configuré ; 0 = gratuit."><input className={inputCls} inputMode="decimal" value={d.pickupFee} onChange={(e) => set({ pickupFee: e.target.value })} data-testid="input-pickup-fee" /></Field>
          </section>
          <section className="rounded-md border border-border bg-card p-6 space-y-4">
            <div className="flex justify-between items-center"><h2 className="font-serif text-2xl">Livraison · 58 wilayas</h2><Toggle on={d.deliveryEnabled} onChange={(v) => set({ deliveryEnabled: v })} label={d.deliveryEnabled ? "Activée" : "Désactivée"} disabled={ro} testId="toggle-delivery" /></div>
            <p className="text-xs text-muted-foreground">Frais vides = mode non proposé pour la wilaya. Délais en jours entiers (1 à 60), obligatoires pour chaque mode tarifé.</p>
            <div className="overflow-x-auto border border-border rounded-md">
              <table className="w-full text-sm min-w-[860px]">
                <thead className="text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/40">
                  <tr><th className="p-2 text-start">Wilaya</th><th className="p-2">Active</th><th className="p-2">Domicile (DA)</th><th className="p-2">Jours dom.</th><th className="p-2">Bureau (DA)</th><th className="p-2">Jours bureau</th></tr>
                </thead>
                <tbody>
                  {d.zones.map((z, i) => {
                    const cell = (k: typeof ZF[number], w = "w-24") => (
                      <input className={`${inputCls} !py-1.5 !px-2 ${w}`} inputMode="decimal" value={z[k]} onChange={(e) => setZone(i, { [k]: e.target.value } as Partial<ZoneDraft>)} data-testid={`input-zone-${k}-${z.code}`} />
                    );
                    return (
                      <tr key={z.code} className={`border-t border-border ${z.enabled ? "bg-[#f7e6ec]/30" : ""}`} data-testid={`row-zone-${z.code}`}>
                        <td className="p-2 whitespace-nowrap"><span className="font-mono text-xs text-muted-foreground me-2">{z.code}</span>{z.nameFr}<span className="block text-xs text-muted-foreground" dir="rtl">{z.nameAr}</span></td>
                        <td className="p-2 text-center"><Toggle on={z.enabled} onChange={(v) => setZone(i, { enabled: v })} label="" disabled={ro} testId={`toggle-zone-${z.code}`} /></td>
                        <td className="p-2">{cell("homeFee")}</td>
                        <td className="p-2"><div className="flex items-center gap-1">{cell("homeMin", "w-14")}–{cell("homeMax", "w-14")}</div></td>
                        <td className="p-2">{cell("deskFee")}</td>
                        <td className="p-2"><div className="flex items-center gap-1">{cell("deskMin", "w-14")}–{cell("deskMax", "w-14")}</div></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </fieldset>
      )}
    </AdminShell>
  );
}

const STATUS: Record<string, [string, string]> = {
  PENDING: ["En attente", "bg-[#f7e6ec] text-[#a82d64]"],
  CANCELLED: ["Annulée", "bg-destructive/10 text-destructive"],
  EXPIRED: ["Expirée", "bg-muted text-muted-foreground"],
};
const Badge = ({ s }: { s: string }) => <span className={`text-xs px-2.5 py-1 rounded-full ${STATUS[s]?.[1] ?? "bg-muted"}`}>{STATUS[s]?.[0] ?? s}</span>;

export function AdminOrdersPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ListAdminOrdersStatus | "">("");
  const [cursors, setCursors] = useState<number[]>([]);
  const params: ListAdminOrdersParams = {};
  if (search.trim()) params.q = search.trim().slice(0, 100);
  if (status) params.status = status;
  const before = cursors[cursors.length - 1];
  if (before) params.before = before;
  const q = useListAdminOrders(params, { query: { queryKey: getListAdminOrdersQueryKey(params), placeholderData: (p) => p, refetchInterval: 20_000 } });
  const reset = () => setCursors([]);
  return (
    <AdminShell title="Commandes" sub="Commandes en ligne reçues. Préparation, expédition et encaissement : phase suivante.">
      <div className="flex flex-col md:flex-row gap-3 mb-6">
        <label className="relative flex-1 md:max-w-sm">
          <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input className={`${inputCls} ps-9`} placeholder="Référence, nom, téléphone" value={search} onChange={(e) => { setSearch(e.target.value); reset(); }} data-testid="input-order-search" />
        </label>
        <select className={`${inputCls} md:w-48`} value={status} onChange={(e) => { setStatus(e.target.value as ListAdminOrdersStatus | ""); reset(); }} data-testid="select-order-status">
          <option value="">Tous les statuts</option>
          {Object.entries(STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
      {q.isLoading ? <Skel h="h-72" /> : q.isError ? (
        <div className="space-y-3"><ErrorText e={q.error} /><button className={btnGhost} onClick={() => q.refetch()}>Réessayer</button></div>
      ) : (q.data?.items.length ?? 0) === 0 ? (
        <div className="border border-dashed border-border rounded-md p-14 text-center" data-testid="status-orders-empty">
          <p className="font-serif text-2xl">Aucune commande.</p>
          <p className="text-sm text-muted-foreground mt-2">Les commandes apparaîtront ici dès que la vente en ligne sera activée.</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-md overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted-foreground border-b border-border">
              <tr><th className="text-start p-3">Référence</th><th className="text-start p-3">Date</th><th className="text-start p-3">Cliente</th><th className="text-start p-3">Mode</th><th className="text-end p-3">Total</th><th className="text-start p-3">Statut</th></tr>
            </thead>
            <tbody>
              {q.data!.items.map((o) => (
                <tr key={o.id} className="border-b border-border last:border-0 hover:bg-accent/40" data-testid={`row-order-${o.id}`}>
                  <td className="p-3"><Link href={`/admin/commandes/${o.id}`} className="text-primary link-underline font-mono">{o.reference}</Link></td>
                  <td className="p-3 whitespace-nowrap">{fmtDate(o.createdAt)}</td>
                  <td className="p-3">{o.customerName}<span className="block text-xs text-muted-foreground">{o.customerPhone}</span></td>
                  <td className="p-3">{o.fulfillment === "DELIVERY" ? `Livraison ${o.deliveryMode === "DESK" ? "bureau" : "domicile"} · ${o.zoneNameFr}` : "Retrait"}</td>
                  <td className="p-3 text-end tabular-nums">{formatDA(o.totalMinor)}</td>
                  <td className="p-3"><Badge s={o.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex gap-3 mt-5">
        {cursors.length > 0 && <button className={btnGhost} onClick={() => setCursors(cursors.slice(0, -1))} data-testid="button-prev-page">Plus récentes</button>}
        {q.data?.nextCursor && <button className={btnGhost} onClick={() => setCursors([...cursors, q.data!.nextCursor!])} data-testid="button-next-page">Plus anciennes</button>}
      </div>
    </AdminShell>
  );
}

export function AdminOrderDetailPage() {
  const { id: raw = "" } = useParams<{ id: string }>();
  const id = Number(raw);
  const valid = Number.isSafeInteger(id) && id > 0;
  const { request } = useSessionCsrf();
  const qc = useQueryClient();
  const invalidate = useInvalidateCommerce();
  const q = useGetAdminOrder(id, { query: { queryKey: getGetAdminOrderQueryKey(id), enabled: valid, refetchInterval: 20_000 } });
  const cancel = useCancelAdminOrder({ request });
  const [reason, setReason] = useState("");
  const o = q.data;
  const doCancel = () => {
    const r = reason.trim();
    if (r.length < 3 || r.length > 500 || !window.confirm("Annuler cette commande ? Le stock réservé sera libéré.")) return;
    cancel.mutate({ id, data: { reason: r } }, {
      onSuccess: (updated) => { qc.setQueryData(getGetAdminOrderQueryKey(id), updated); invalidate(); setReason(""); },
    });
  };
  return (
    <AdminShell title={o ? `Commande ${o.reference}` : "Commande"} actions={<Link href="/admin/commandes" className={btnGhost}><ArrowLeft className="w-4 h-4" />Commandes</Link>}>
      {!valid ? <p>Identifiant invalide.</p> : q.isLoading ? <Skel h="h-96" /> : q.isError || !o ? (
        <div className="space-y-3"><ErrorText e={q.error} /><button className={btnGhost} onClick={() => q.refetch()}>Réessayer</button></div>
      ) : (
        <div className="grid lg:grid-cols-[1.4fr_1fr] gap-6">
          <div className="space-y-6">
            <section className="bg-card border border-border rounded-md p-6">
              <div className="flex flex-wrap gap-3 items-center justify-between"><Badge s={o.status} /><span className="text-xs px-2.5 py-1 rounded-full bg-muted">Non payée · {o.paymentMethod === "COD" ? "Paiement à la livraison" : "Paiement au retrait"}</span></div>
              {o.deliveryMinDays !== null && <p className="text-sm mt-3">Délai annoncé : {o.deliveryMinDays}–{o.deliveryMaxDays} jours</p>}
              <p className="text-sm text-muted-foreground mt-3">Créée le {fmtDateLong(o.createdAt)} · expire le {fmtDateLong(o.expiresAt)} (Alger)</p>
              <ul className="divide-y divide-border mt-4">
                {o.items.map((l) => (
                  <li key={l.variantId} className="py-3 flex justify-between gap-4 text-sm">
                    <span>{l.productName}<span className="block text-xs text-muted-foreground">{l.sku} · {l.size} · {l.color} · x{l.quantity} · {formatDA(l.unitPriceMinor)}</span></span>
                    <span className="tabular-nums">{formatDA(l.lineTotalMinor)}</span>
                  </li>
                ))}
              </ul>
              <dl className="text-sm border-t border-border pt-3 space-y-1">
                <div className="flex justify-between"><dt>Sous-total</dt><dd>{formatDA(o.subtotalMinor)}</dd></div>
                <div className="flex justify-between"><dt>Frais</dt><dd>{formatDA(o.feeMinor)}</dd></div>
                <div className="flex justify-between font-serif text-xl"><dt>Total</dt><dd data-testid="text-order-total">{formatDA(o.totalMinor)}</dd></div>
              </dl>
            </section>
            <section className="bg-card border border-border rounded-md p-6">
              <h2 className="font-serif text-2xl mb-3">Historique</h2>
              <ol className="space-y-2 text-sm">
                {o.events.map((e, i) => <li key={i} className="flex gap-3"><span className="text-muted-foreground whitespace-nowrap">{fmtDate(e.createdAt)}</span><span className="font-medium">{e.kind}</span>{e.reason && <span className="text-muted-foreground">{e.reason}</span>}</li>)}
              </ol>
            </section>
          </div>
          <div className="space-y-6">
            <section className="bg-card border border-border rounded-md p-6 text-sm space-y-2" data-testid="panel-customer">
              <h2 className="font-serif text-2xl mb-2">Cliente</h2>
              <p className="font-medium">{o.customerName}</p>
              <p dir="ltr" className="text-start"><a href={`tel:${o.customerPhone}`} className="text-primary link-underline">{o.customerPhone}</a></p>
              <p>{o.fulfillment === "DELIVERY" ? `Livraison ${o.deliveryMode === "DESK" ? "bureau" : "domicile"} · ${o.zoneNameFr}` : `Retrait · ${o.pickupAddressFr}`}</p>
              {o.fulfillment === "DELIVERY" && <p className="text-muted-foreground">{o.commune}{o.address && <><br />{o.address}</>}</p>}
              {o.notes && <p className="text-muted-foreground border-t border-border pt-2">{o.notes}</p>}
            </section>
            {o.status === "PENDING" && (
              <section className="bg-card border border-destructive/30 rounded-md p-6 space-y-3">
                <h2 className="font-serif text-2xl">Annuler la commande</h2>
                <Field label="Motif (3 à 500 caractères)"><textarea className={`${inputCls} min-h-20`} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="input-cancel-reason" /></Field>
                <ErrorText e={cancel.error} />
                <button className={`${btnDark} !bg-destructive`} disabled={reason.trim().length < 3 || cancel.isPending} onClick={doCancel} data-testid="button-cancel-order">{cancel.isPending ? "Annulation..." : "Annuler et libérer le stock"}</button>
              </section>
            )}
          </div>
        </div>
      )}
    </AdminShell>
  );
}
