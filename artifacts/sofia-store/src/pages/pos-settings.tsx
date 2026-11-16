import { useEffect, useState } from "react";
import { Redirect } from "wouter";
import { AlertTriangle, Check } from "lucide-react";
import { useUpdateReceiptSettings } from "@workspace/api-client-react";
import { AdminShell } from "@/pages/admin";
import { btnDark, inputCls, Field, Skel, ErrorText } from "@/components/admin/shell-primitives";
import { PosTabs } from "@/components/pos/pos-tabs";
import { usePos, useInvalidatePos } from "@/lib/pos";

export function PosSettingsPage() {
  const { enabled, ctx, request } = usePos();
  const c = ctx.data;
  const [f, setF] = useState({ address: "", phone: "", footer: "" });
  const [saved, setSaved] = useState(false);
  const save = useUpdateReceiptSettings({ request });
  const invalidate = useInvalidatePos();
  const rs = c?.receiptSettings;
  useEffect(() => { if (rs) setF({ address: rs.address, phone: rs.phone, footer: rs.footer }); }, [rs?.address, rs?.phone, rs?.footer]); // eslint-disable-line react-hooks/exhaustive-deps

  if (c && !c.canManage) return <Redirect to="/pos" />;
  return (
    <AdminShell title="Réglages du ticket" sub="S'applique uniquement aux prochaines ventes : les tickets passés gardent leur copie.">
      <PosTabs />
      {!enabled || ctx.isLoading ? <Skel h="h-80" /> : ctx.isError ? <ErrorText e={ctx.error} /> : (
        <div className="grid lg:grid-cols-[1fr_auto] gap-8 items-start">
          <form className="bg-card border border-border rounded-md p-6 space-y-4 max-w-xl" onSubmit={(e) => {
            e.preventDefault(); setSaved(false);
            save.mutate({ data: { address: f.address.trim(), phone: f.phone.trim(), footer: f.footer.trim() } }, { onSuccess: () => { setSaved(true); invalidate(); } });
          }}>
            {(!f.address.trim() || !f.phone.trim()) && (
              <p className="text-xs flex gap-2 text-[#8a4a24] bg-[#fbf1ea] rounded px-3 py-2" data-testid="status-settings-warning"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />Adresse ou téléphone vide : les tickets n'afficheront que « SOFIA STORE ».</p>
            )}
            <Field label="Adresse" hint={`${f.address.length}/500`}><textarea rows={3} maxLength={500} className={inputCls} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} data-testid="input-receipt-address" /></Field>
            <Field label="Téléphone" hint={`${f.phone.length}/60`}><input maxLength={60} className={inputCls} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} data-testid="input-receipt-phone" /></Field>
            <Field label="Pied de ticket (facultatif)" hint={`${f.footer.length}/500`}><textarea rows={3} maxLength={500} className={inputCls} value={f.footer} onChange={(e) => setF({ ...f, footer: e.target.value })} data-testid="input-receipt-footer" /></Field>
            <ErrorText e={save.error} />
            <div className="flex items-center gap-3">
              <button className={btnDark} disabled={save.isPending} data-testid="button-save-receipt">{save.isPending ? "Enregistrement…" : "Enregistrer"}</button>
              {saved && <span className="text-sm text-emerald-700 inline-flex items-center gap-1 rise"><Check className="w-4 h-4" />Enregistré pour les prochaines ventes</span>}
            </div>
          </form>
          <div className="bg-[#efe6df] rounded-md p-6">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-3 text-center">Aperçu de l'en-tête</p>
            <div className="bg-[#fffdfa] font-mono text-[12px] w-[80mm] max-w-full px-4 py-5 mx-auto border border-border/60">
              <p className="text-center font-bold tracking-[.2em] text-[1.25em]">SOFIA STORE</p>
              {f.address && <p className="text-center whitespace-pre-line mt-1">{f.address}</p>}
              {f.phone && <p className="text-center">Tél. {f.phone}</p>}
              <div className="border-t border-dashed border-current my-3" />
              <p className="text-center text-muted-foreground">(lignes de la vente)</p>
              <div className="border-t border-dashed border-current my-3" />
              {f.footer && <p className="text-center whitespace-pre-line">{f.footer}</p>}
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
