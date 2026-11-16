import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { Lock, Vault } from "lucide-react";
import { useOpenRegister, useCancelRegisterRequest, type PosContext, type RegisterOpening } from "@workspace/api-client-react";
import { formatDA, errMsg } from "@/lib/util";
import { classify, newRequestId, parseMoney, useInvalidatePos, loadPending, savePending, openingKey } from "@/lib/pos";
import { inputCls, btnDark, btnGhost } from "@/components/admin/shell-primitives";

export function OpenRegisterPanel({ ctx, request, pendingOnly = false }: { ctx: PosContext; request: { headers: Record<string, string> }; pendingOnly?: boolean }) {
  const [raw, setRaw] = useState("");
  const [confirming, setConfirming] = useState(false);
  const key = openingKey(ctx.userId);
  const [pending, setPendingState] = useState<RegisterOpening | null>(() => loadPending<RegisterOpening>(key));
  const setPending = (v: RegisterOpening | null) => { savePending(key, v); setPendingState(v); };
  const [err, setErr] = useState<{ e: unknown; uncertain: boolean } | null>(() => (pending ? { e: null, uncertain: true } : null));
  const cancel = useCancelRegisterRequest({ request });
  const [cancelErr, setCancelErr] = useState<unknown>(null);
  const [resolved, setResolved] = useState<string>("");
  const open = useOpenRegister({ request });
  const invalidate = useInvalidatePos();
  const amount = pending ? pending.openingMinor : parseMoney(raw);

  const pendingBlock = pending && (
    <div className="mt-5 rounded-md border border-secondary/30 bg-[#fbf1ea] p-4 text-sm space-y-2" data-testid="status-opening-pending">
      <p>Ouverture de {formatDA(pending.openingMinor)} en attente de confirmation. Elle sera renvoyée à l'identique, ou annulée définitivement par le serveur.</p>
      {err && err.e != null && <p className="text-xs text-destructive">{err.uncertain ? "Réponse non reçue. " : ""}{errMsg(err.e)}</p>}
      {cancelErr != null && <p className="text-xs text-destructive">Annulation non confirmée, la demande reste verrouillée : {errMsg(cancelErr)}</p>}
      <div className="flex flex-wrap gap-2">
        <button className={`${btnDark} !px-3 !py-1.5 text-xs`} disabled={open.isPending || cancel.isPending} onClick={go} data-testid="button-retry-open">{open.isPending ? "Envoi…" : "Réessayer à l'identique"}</button>
        <button className={`${btnGhost} !px-3 !py-1.5 text-xs`} disabled={open.isPending || cancel.isPending} onClick={abandon} data-testid="button-cancel-open">{cancel.isPending ? "Annulation…" : "Annuler cette ouverture"}</button>
      </div>
    </div>
  );
  if (pendingOnly) return pendingBlock ? <div className="mb-4">{pendingBlock}</div> : resolved ? <p className="mb-4 text-sm text-emerald-700" data-testid="status-opening-resolved">{resolved}</p> : null;

  if (!ctx.canSell) {
    return <Notice title="Caisse non autorisée" text="Votre compte ne peut pas encaisser. Demandez à un responsable." />;
  }
  const s = ctx.activeSession;
  if (s && s.openedById !== ctx.userId) {
    return (
      <Notice title={`Tiroir ouvert par ${s.openedBy}`}
        text={`Le tiroir ${ctx.registerName} est utilisé depuis le ${new Date(s.openedAt).toLocaleString("fr-FR", { timeZone: "Africa/Algiers" })}. Seule la personne qui l'a ouvert peut y encaisser.`}>
        {ctx.canManage && <Link href="/pos/sessions" className={`${btnGhost} mt-4`} data-testid="link-close-other">Clôturer cette session</Link>}
      </Notice>
    );
  }

  const send = (p: RegisterOpening) => {
    setErr(null);
    open.mutate({ data: p }, {
      onSuccess: () => { setPending(null); setConfirming(false); setRaw(""); invalidate(); },
      onError: (e) => { setErr({ e, uncertain: classify(e) === "uncertain" }); invalidate(); },
    });
  };
  function abandon() {
    if (!pending) return;
    if (!confirm("Demander au serveur d'annuler définitivement cette ouverture ?")) return;
    setCancelErr(null);
    cancel.mutate({ data: { requestId: pending.requestId, kind: "OPEN", registerSessionId: null } }, {
      onSuccess: (r) => {
        setPending(null); setErr(null); setConfirming(false); invalidate();
        setResolved(r.cancelled ? "Ouverture annulée par le serveur. Vous pouvez saisir un nouveau montant." : "Cette ouverture avait déjà été enregistrée : le tiroir est ouvert.");
      },
      onError: (e) => setCancelErr(e),
    });
  };
  function go() {
    // Never mint a new key while a previous opening is unresolved: always resend the stored one.
    const p = pending ?? (amount !== null ? { openingMinor: amount, requestId: newRequestId() } : null);
    if (!p) return;
    if (!pending) setPending(p);
    send(p);
  };

  return (
    <div className="max-w-lg mx-auto bg-card border border-border rounded-md p-8 rise" data-testid="panel-open-register">
      <Vault className="w-8 h-8 text-primary" strokeWidth={1.3} />
      <p className="eyebrow mt-4">{ctx.registerName}</p>
      <h2 className="font-serif text-3xl mt-1">Ouvrir le tiroir</h2>
      <p className="text-sm text-muted-foreground mt-2">Comptez le fond de caisse réellement présent. Vous serez la seule personne à encaisser dans cette session.</p>
      <label className="block mt-6">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">Fond de caisse (DA)</span>
        <input inputMode="decimal" className={`${inputCls} mt-1.5 font-mono text-lg`} value={pending ? (pending.openingMinor / 100).toFixed(2).replace(".", ",") : raw} disabled={confirming || !!pending}
          onChange={(e) => setRaw(e.target.value)} placeholder="0,00" data-testid="input-opening" />
      </label>
      {!pending && raw && amount === null && <p className="text-xs text-destructive mt-1">Montant invalide (max 2 décimales, 10 000 000 DA).</p>}
      {resolved && <p className="text-sm mt-3 text-emerald-700" data-testid="status-opening-resolved">{resolved}</p>}
      {!pending && err && <p className="text-sm mt-3 text-destructive bg-destructive/5 border border-destructive/20 rounded-md px-3 py-2">
        {err.uncertain ? "Réponse non reçue : la session est peut-être déjà ouverte. Réessayez, la même demande sera réutilisée sans doublon. " : ""}{errMsg(err.e)}
      </p>}
      {pending ? pendingBlock : !confirming ? (
        <button className={`${btnDark} w-full mt-5`} disabled={amount === null} onClick={() => setConfirming(true)} data-testid="button-open-register">Continuer</button>
      ) : (
        <div className="mt-5 rounded-md border border-primary/30 bg-accent/50 p-4">
          <p className="text-sm">Confirmer un fond de caisse de <span className="font-mono font-semibold">{amount !== null ? formatDA(amount) : ""}</span> ?</p>
          <div className="flex gap-2 mt-3">
            <button className={btnGhost} disabled={open.isPending} onClick={() => setConfirming(false)}>Modifier</button>
            <button className={`${btnDark} flex-1`} disabled={open.isPending} onClick={go} data-testid="button-confirm-open">{open.isPending ? "Ouverture…" : "Confirmer l'ouverture"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Notice({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  return (
    <div className="max-w-lg mx-auto bg-card border border-border rounded-md p-8 text-center rise" data-testid="status-register-locked">
      <Lock className="w-7 h-7 mx-auto text-secondary" strokeWidth={1.3} />
      <h2 className="font-serif text-3xl mt-3">{title}</h2>
      <p className="text-sm text-muted-foreground mt-2">{text}</p>
      {children}
    </div>
  );
}
