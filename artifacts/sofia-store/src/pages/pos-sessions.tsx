import { useState } from "react";
import { Link } from "wouter";
import { Vault } from "lucide-react";
import { useListRegisterSessions, getListRegisterSessionsQueryKey, useCloseRegister, useCancelRegisterRequest, type RegisterSession, type RegisterClosing } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AdminShell } from "@/pages/admin";
import { btnDark, btnGhost, inputCls, ErrorText } from "@/components/admin/shell-primitives";
import { PosTabs } from "@/components/pos/pos-tabs";
import { usePos, fmtDate, parseMoney, newRequestId, classify, useInvalidatePos, usePendingRequest, validClosing, closingKey } from "@/lib/pos";
import { formatDA, errMsg } from "@/lib/util";

export function PosSessionsPage() {
  const { enabled, ctx, user, request } = usePos();
  const [cursors, setCursors] = useState<(number | undefined)[]>([undefined]);
  const [closing, setClosing] = useState<RegisterSession | null>(null);
  const c = ctx.data;
  const canClose = (s: RegisterSession) => s.status === "OPEN" && (s.openedById === user?.id || !!c?.canManage);
  const active = c?.activeSession;
  return (
    <AdminShell title="Tiroir-caisse" sub="Ouvertures, clôtures et écarts de caisse.">
      <PosTabs />
      {active ? (
        <div className="mb-6 grid sm:grid-cols-3 lg:grid-cols-6 gap-px bg-border border border-border rounded-md overflow-hidden" data-testid="panel-active-session">
          <Stat k="Fond d'ouverture" v={formatDA(active.openingMinor)} />
          <Stat k="Ventes" v={`+${formatDA(active.salesMinor)}`} />
          <Stat k="Remboursements" v={`-${formatDA(active.refundsMinor)}`} />
          <Stat k="Encaiss. web" v={`+${formatDA(active.webReceiptsMinor)}`} />
          <Stat k="Rembours. web" v={`-${formatDA(active.webRefundsMinor)}`} />
          <div className="bg-[#282326] text-[#f6efe9] p-4">
            <p className="text-[10px] uppercase tracking-wider opacity-70">Attendu en tiroir</p>
            <p className="font-serif text-3xl mt-1">{formatDA(active.expectedMinor)}</p>
            {canClose(active) && <button className="mt-2 text-xs underline underline-offset-4 hover:text-primary" onClick={() => setClosing(active)} data-testid="button-close-active">Clôturer</button>}
          </div>
        </div>
      ) : c && (
        <div className="mb-6 rounded-md border border-dashed border-border p-5 flex items-center gap-4">
          <Vault className="w-6 h-6 text-primary" strokeWidth={1.3} />
          <p className="text-sm flex-1">Aucun tiroir ouvert sur {c.registerName}.</p>
          <Link href="/pos" className={btnDark}>Ouvrir depuis la caisse</Link>
        </div>
      )}
      <div className="bg-card border border-border rounded-md overflow-x-auto">
        <table className="w-full text-sm min-w-[980px]">
          <thead className="text-[10px] uppercase tracking-wider text-muted-foreground bg-muted/40">
            <tr className="text-left">{["Session", "Ouverte", "Clôturée", "Fond", "Ventes", "Rembours.", "Web +", "Web -", "Attendu", "Compté", "Écart", ""].map((h) => <th key={h} className="px-3 py-2 font-normal">{h}</th>)}</tr>
          </thead>
          <tbody>
            {cursors.map((cur, i) => (
              <SessionRows key={cur ?? "first"} enabled={enabled} before={cur} last={i === cursors.length - 1}
                onMore={(n) => setCursors((cs) => [...cs, n])} canClose={canClose} onClose={setClosing} />
            ))}
          </tbody>
        </table>
      </div>
      {closing && user && <CloseDialog session={closing} userId={user.id} onClose={() => setClosing(null)} request={request} isOther={closing.openedById !== user.id} />}
    </AdminShell>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return <div className="bg-card p-4"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">{k}</p><p className="font-mono text-lg mt-1">{v}</p></div>;
}

function SessionRows({ enabled, before, last, onMore, canClose, onClose }: {
  enabled: boolean; before?: number; last: boolean; onMore: (n: number) => void; canClose: (s: RegisterSession) => boolean; onClose: (s: RegisterSession) => void;
}) {
  const params = before ? { before } : {};
  const r = useListRegisterSessions(params, { query: { queryKey: getListRegisterSessionsQueryKey(params), enabled } });
  if (r.isLoading || !enabled) return <tr><td colSpan={12} className="p-4"><div className="h-24 bg-muted animate-pulse rounded" /></td></tr>;
  if (r.isError) return <tr><td colSpan={12} className="p-4"><ErrorText e={r.error} /><button className={`${btnGhost} mt-2`} onClick={() => r.refetch()}>Réessayer</button></td></tr>;
  const items = r.data?.items ?? [];
  if (!before && items.length === 0) return <tr><td colSpan={12} className="py-14 text-center font-serif text-2xl" data-testid="status-sessions-empty">Aucune session de caisse.</td></tr>;
  return (
    <>
      {items.map((s) => {
        const v = s.varianceMinor;
        return (
          <tr key={s.id} className="border-t border-border align-top" data-testid={`row-session-${s.id}`}>
            <td className="px-3 py-2.5"><span className="font-mono">#{s.id}</span><br /><span className={`text-[10px] uppercase tracking-wider ${s.status === "OPEN" ? "text-emerald-700" : "text-muted-foreground"}`}>{s.status === "OPEN" ? "Ouverte" : "Clôturée"}</span></td>
            <td className="px-3 py-2.5">{fmtDate(s.openedAt)}<br /><span className="text-xs text-muted-foreground">{s.openedBy}</span></td>
            <td className="px-3 py-2.5">{s.closedAt ? <>{fmtDate(s.closedAt)}<br /><span className="text-xs text-muted-foreground">{s.closedBy}</span></> : "-"}
              {s.closeReason && <p className="text-xs text-muted-foreground max-w-[180px] break-words">{s.closeReason}</p>}</td>
            <td className="px-3 py-2.5 font-mono">{formatDA(s.openingMinor)}</td>
            <td className="px-3 py-2.5 font-mono">{formatDA(s.salesMinor)}</td>
            <td className="px-3 py-2.5 font-mono">{formatDA(s.refundsMinor)}</td>
            <td className="px-3 py-2.5 font-mono" data-testid={`text-web-receipts-${s.id}`}>{formatDA(s.webReceiptsMinor)}</td>
            <td className="px-3 py-2.5 font-mono" data-testid={`text-web-refunds-${s.id}`}>{formatDA(s.webRefundsMinor)}</td>
            <td className="px-3 py-2.5 font-mono">{formatDA(s.expectedMinor)}</td>
            <td className="px-3 py-2.5 font-mono">{s.countedMinor != null ? formatDA(s.countedMinor) : "-"}</td>
            <td className={`px-3 py-2.5 font-mono ${v == null ? "" : v === 0 ? "text-emerald-700" : "text-destructive"}`}>{v == null ? "-" : `${v > 0 ? "+" : ""}${formatDA(v)}`}</td>
            <td className="px-3 py-2.5">{canClose(s) && <button className={`${btnGhost} !px-3 !py-1 text-xs`} onClick={() => onClose(s)} data-testid={`button-close-${s.id}`}>Clôturer</button>}</td>
          </tr>
        );
      })}
      {last && r.data?.nextCursor != null && (
        <tr><td colSpan={12} className="p-3 text-center"><button className={btnGhost} onClick={() => onMore(r.data!.nextCursor!)} data-testid="button-sessions-more">Sessions plus anciennes</button></td></tr>
      )}
    </>
  );
}

function CloseDialog({ session, userId, onClose, request, isOther }: { session: RegisterSession; userId: number; onClose: () => void; request: { headers: Record<string, string> }; isOther: boolean }) {
  const key = closingKey(userId, session.id);
  const { pending, setPending, storageError, storageBlocked } = usePendingRequest<RegisterClosing>(key, validClosing);
  const [raw, setRaw] = useState(() => (pending ? (pending.countedMinor / 100).toFixed(2).replace(".", ",") : ""));
  const [reason, setReason] = useState(pending?.reason ?? "");
  const [ack, setAck] = useState(!!pending);
  const [err, setErr] = useState<{ e: unknown; uncertain: boolean } | null>(() => (pending ? { e: null, uncertain: true } : null));
  const cancel = useCancelRegisterRequest({ request });
  const [cancelErr, setCancelErr] = useState<unknown>(null);
  const [note, setNote] = useState("");
  const close = useCloseRegister({ request });
  const invalidate = useInvalidatePos();
  const counted = pending ? pending.countedMinor : parseMoney(raw);
  const variance = counted !== null ? counted - session.expectedMinor : null;
  const valid = !storageBlocked && (!!pending || (counted !== null && reason.trim().length >= 3 && ack));
  const go = () => {
    // Reuse the stored closing request while its outcome is unknown; never mint a second key.
    const p = pending ?? (counted !== null ? { countedMinor: counted, reason: reason.trim(), requestId: newRequestId() } : null);
    if (!p || !valid) return;
    if (!pending && !setPending(p)) return;
    setErr(null);
    close.mutate({ id: session.id, data: p }, {
      onSuccess: () => { setPending(null); invalidate(); onClose(); },
      onError: (e) => { setErr({ e, uncertain: classify(e) === "uncertain" }); invalidate(); },
    });
  };
  const abandon = () => {
    if (!pending) return;
    if (!confirm("Demander au serveur d'annuler définitivement cette clôture ?")) return;
    setCancelErr(null);
    cancel.mutate({ data: { requestId: pending.requestId, kind: "CLOSE", registerSessionId: session.id } }, {
      onSuccess: (r) => {
        setPending(null); setErr(null); invalidate();
        if (r.cancelled) { setAck(false); setNote("Clôture annulée par le serveur. Vous pouvez corriger le comptage."); }
        else onClose(); // closing had already been recorded
      },
      onError: (e) => setCancelErr(e),
    });
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !close.isPending && !cancel.isPending) onClose(); }}>
      <DialogContent className="max-w-md" dir="ltr">
        <DialogHeader>
          <DialogTitle className="font-serif text-3xl font-normal">Clôturer la session #{session.id}</DialogTitle>
          <DialogDescription>{isOther ? `Session ouverte par ${session.openedBy}. Clôture par un responsable.` : "Comptez les espèces réellement présentes."}</DialogDescription>
        </DialogHeader>
        {storageError && <p role="alert" className="text-sm text-destructive">{storageError}</p>}
        <dl className="text-xs space-y-0.5 border-b border-border pb-2" data-testid="panel-close-summary">
          {([["Fond", session.openingMinor, ""], ["Ventes caisse", session.salesMinor, "+"], ["Remboursements caisse", session.refundsMinor, "-"], ["Encaissements web (espèces)", session.webReceiptsMinor, "+"], ["Remboursements web (espèces)", session.webRefundsMinor, "-"]] as const).map(([k, v, sg]) => (
            <div key={k} className="flex justify-between"><dt className="text-muted-foreground">{k}</dt><dd className="font-mono">{sg}{formatDA(v)}</dd></div>
          ))}
        </dl>
        <div className="flex justify-between text-sm"><span className="text-muted-foreground">Attendu (serveur)</span><span className="font-mono">{formatDA(session.expectedMinor)}</span></div>
        <label className="block"><span className="text-xs uppercase tracking-wide text-muted-foreground">Espèces comptées (DA)</span>
          <input inputMode="decimal" className={`${inputCls} mt-1 font-mono text-lg`} value={raw} disabled={!!pending} onChange={(e) => { setRaw(e.target.value); setAck(false); }} data-testid="input-counted" /></label>
        {!pending && raw && counted === null && <p className="text-xs text-destructive">Montant invalide.</p>}
        {variance !== null && (
          <div className={`rounded-md px-4 py-3 flex justify-between items-center ${variance === 0 ? "bg-emerald-50 text-emerald-800" : "bg-destructive/10 text-destructive"}`} data-testid="text-variance">
            <span className="text-xs uppercase tracking-wider">{variance === 0 ? "Caisse juste" : variance > 0 ? "Excédent" : "Manquant"}</span>
            <span className="font-mono text-lg">{variance > 0 ? "+" : ""}{formatDA(variance)}</span>
          </div>
        )}
        <label className="block"><span className="text-xs uppercase tracking-wide text-muted-foreground">Motif / commentaire (obligatoire)</span>
          <textarea rows={2} maxLength={500} className={`${inputCls} mt-1`} value={reason} disabled={!!pending} onChange={(e) => setReason(e.target.value)} data-testid="input-close-reason" /></label>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="accent-[#F04F94] mt-1" checked={ack} disabled={counted === null || !!pending} onChange={(e) => setAck(e.target.checked)} data-testid="checkbox-close-ack" />
          Je confirme le comptage{variance ? ` et l'écart de ${formatDA(variance)}` : ""}. La clôture est définitive.</label>
        {pending && <div className="text-xs rounded bg-[#fbf1ea] text-[#8a4a24] px-3 py-2 space-y-1.5" data-testid="status-closing-pending">
          <p>Clôture en attente de confirmation : elle sera renvoyée à l'identique, ou annulée définitivement par le serveur.</p>
          <button className="underline" disabled={close.isPending || cancel.isPending} onClick={abandon} data-testid="button-cancel-close">{cancel.isPending ? "Annulation…" : "Annuler cette clôture"}</button>
          {cancelErr != null && <p className="text-destructive">Annulation non confirmée, la demande reste verrouillée : {errMsg(cancelErr)}</p>}
        </div>}
        {note && !pending && <p className="text-xs text-emerald-700">{note}</p>}
        {err && err.e != null && <p className="text-sm text-destructive">{err.uncertain ? "Réponse non reçue. " : ""}{errMsg(err.e)}</p>}
        <div className="flex justify-end gap-2">
          <button className={btnGhost} disabled={close.isPending} onClick={onClose}>Annuler</button>
          <button className={btnDark} disabled={!valid || close.isPending || cancel.isPending} onClick={go} data-testid="button-confirm-close">{close.isPending ? "Clôture…" : pending ? "Réessayer à l'identique" : "Clôturer"}</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
