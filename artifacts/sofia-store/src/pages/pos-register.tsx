import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, CheckCircle2, RefreshCw, ShoppingBag, Trash2, ArrowRight, Receipt as ReceiptIcon } from "lucide-react";
import {
  useCreatePosSale, useRecoverPosSale, useCancelPosSaleRequest, getRecoverPosSaleQueryKey, lookupPosBarcode,
  type PosVariant, type PosSale, type CashSaleInput,
} from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AdminShell } from "@/pages/admin";
import { btnDark, btnGhost, inputCls, Skel, ErrorText } from "@/components/admin/shell-primitives";
import { PosTabs } from "@/components/pos/pos-tabs";
import { ScannerInput } from "@/components/pos/scanner-input";
import { VariantSearch } from "@/components/pos/variant-search";
import { OpenRegisterPanel } from "@/components/pos/open-register";
import { BasketLineRow, MoneyInput } from "@/components/pos/basket-line";
import { formatDA, errMsg } from "@/lib/util";
import {
  usePos, useInvalidatePos, loadDraft, saveDraft, STORAGE_WRITE_ERROR, STORAGE_CLEANUP_WARNING, STORAGE_CORRUPT_MESSAGE, emptyDraft, basketTotals, classify, newRequestId, parseMoney, statusOf,
  MAX_LINES, MAX_QTY, type PosDraft, type Outcome,
} from "@/lib/pos";

export function PosRegisterPage() {
  const { user, enabled, ctx, request } = usePos();
  return (
    <AdminShell title="Caisse" sub="Vente au comptoir, espèces uniquement. Connexion au serveur requise.">
      <PosTabs />
      {!enabled || ctx.isLoading ? <div className="grid lg:grid-cols-[1.4fr_1fr] gap-6"><Skel h="h-96" /><Skel h="h-96" /></div>
        : ctx.isError ? <div className="max-w-md"><ErrorText e={ctx.error} /><button className={`${btnGhost} mt-3`} onClick={() => ctx.refetch()}>Réessayer</button></div>
        : ctx.data && user && <RegisterGate key={user.id} userId={user.id} request={request} />}
    </AdminShell>
  );
}

/** Refuses to start a till over an unreadable stored draft/pending sale (never auto-deleted). */
function RegisterGate({ userId, request }: { userId: number; request: { headers: Record<string, string> } }) {
  const [loaded] = useState(() => loadDraft(userId));
  if (!loaded.ok) {
    return (
      <div className="max-w-xl mx-auto bg-card border border-destructive/30 rounded-md p-8 rise" data-testid="status-draft-corrupt">
        <AlertTriangle className="w-7 h-7 text-destructive" strokeWidth={1.4} />
        <h2 className="font-serif text-3xl mt-3">Caisse bloquée dans cet onglet</h2>
        <p className="text-sm text-muted-foreground mt-2">{STORAGE_CORRUPT_MESSAGE}</p>
        <div className="flex gap-2 mt-5">
          <Link href="/pos/historique" className={btnGhost}>Historique des tickets</Link>
          <Link href="/pos/sessions" className={btnGhost}>Sessions de tiroir</Link>
        </div>
      </div>
    );
  }
  return <Register userId={userId} request={request} initial={loaded.value ?? emptyDraft()} />;
}

type DraftMode = "edit" | "arm" | "cleanup";

function Register({ userId, request, initial }: { userId: number; request: { headers: Record<string, string> }; initial: PosDraft }) {
  const { ctx } = usePos();
  const c = ctx.data!;
  const invalidate = useInvalidatePos();
  const [draft, setDraftState] = useState<PosDraft>(initial);
  const draftRef = useRef(draft);
  const [storageMsg, setStorageMsg] = useState("");
  /**
   * Persist first. "arm" (pending payload before a POST) fails closed: nothing changes and false is returned.
   * "cleanup" (after a confirmed result) and "edit" still update memory but surface a warning.
   */
  const setDraft = (fn: (d: PosDraft) => PosDraft, mode: DraftMode = "edit") => {
    const next = fn(draftRef.current);
    const ok = saveDraft(userId, next);
    if (!ok && mode === "arm") { setStorageMsg(STORAGE_WRITE_ERROR); return false; }
    if (!ok) setStorageMsg(mode === "cleanup" ? STORAGE_CLEANUP_WARNING : "Le panier n'a pas pu être sauvegardé dans cet onglet (stockage bloqué ou plein). Aucun encaissement ne sera envoyé tant que la sauvegarde échoue.");
    else if (mode !== "cleanup") setStorageMsg("");
    draftRef.current = next;
    setDraftState(next);
    return true;
  };
  const [tendered, setTendered] = useState("");
  const [note, setNote] = useState<{ tone: "warn" | "err"; text: string } | null>(null);
  const [focusSignal, setFocusSignal] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [outcome, setOutcome] = useState<{ kind: Outcome; e: unknown } | null>(() => (draft.pending ? { kind: "uncertain", e: null } : null));
  const [recovery, setRecovery] = useState<"idle" | "checking" | "absent" | "error">("idle");
  const [done, setDone] = useState<PosSale | null>(null);
  const create = useCreatePosSale({ request });
  const cancelSale = useCancelPosSaleRequest({ request });
  const [cancelErr, setCancelErr] = useState<unknown>(null);

  const pending = draft.pending;
  const locked = !!pending || create.isPending;
  const s = c.activeSession;
  const mine = !!s && s.openedById === userId && c.canSell;

  const recover = useRecoverPosSale(pending?.requestId ?? "", { query: { queryKey: getRecoverPosSaleQueryKey(pending?.requestId ?? ""), enabled: false, retry: false } });

  useEffect(() => {
    if (!pending) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [pending]);

  const t = basketTotals(draft);
  const tenderedMinor = parseMoney(tendered);
  const change = tenderedMinor !== null ? tenderedMinor - t.net : null;
  const needsReason = t.discounts > 0;
  const problems: string[] = [];
  if (draft.lines.length === 0) problems.push("Panier vide.");
  if (draft.lines.some((l) => l.discountMinor > l.variant.priceMinor * l.quantity)) problems.push("Une remise de ligne dépasse son montant.");
  if (draft.orderDiscountMinor > t.afterLines) problems.push("La remise globale dépasse le total.");
  if (t.discounts > 0 && !c.canManage) problems.push("Les remises exigent un responsable.");
  if (needsReason && draft.discountReason.trim().length < 3) problems.push("Motif de remise requis (3 caractères min.).");
  if (draft.lines.some((l) => l.quantity > l.variant.available)) problems.push("Quantité au-delà du stock signalé.");
  if (tenderedMinor === null) problems.push("Saisissez les espèces reçues.");
  else if (change !== null && change < 0) problems.push("Espèces insuffisantes.");
  if (t.net > 1_000_000_000) problems.push("Montant hors limite.");

  const addVariant = (v: PosVariant) => {
    if (locked) return;
    setNote(null);
    if (v.available <= 0) { setNote({ tone: "err", text: `${v.productName} ${v.size}/${v.color} est en rupture : vente impossible.` }); return; }
    setDraft((d) => {
      const i = d.lines.findIndex((l) => l.variant.id === v.id);
      if (i < 0) {
        if (d.lines.length >= MAX_LINES) { setNote({ tone: "err", text: `Maximum ${MAX_LINES} références différentes par ticket.` }); return d; }
        return { ...d, lines: [{ variant: v, quantity: 1, discountMinor: 0 }, ...d.lines] };
      }
      const cur = d.lines[i];
      const cap = Math.min(v.available, MAX_QTY);
      if (cur.quantity >= cap) { setNote({ tone: "err", text: `Stock atteint pour ${v.sku} (${v.available} disponible).` }); return d; }
      if (cur.variant.priceMinor !== v.priceMinor) setNote({ tone: "warn", text: `Prix de ${v.sku} modifié : ${formatDA(cur.variant.priceMinor)} vers ${formatDA(v.priceMinor)}. Ligne mise à jour au prix actuel.` });
      const lines = [...d.lines];
      lines[i] = { ...cur, variant: v, quantity: cur.quantity + 1 };
      return { ...d, lines };
    });
  };
  const inBasket = (id: number) => draft.lines.find((l) => l.variant.id === id)?.quantity ?? 0;

  const buildPayload = (): CashSaleInput | null => {
    if (!s || problems.length || tenderedMinor === null) return null;
    return {
      requestId: newRequestId(),
      registerSessionId: s.id,
      items: draft.lines.map((l) => ({ variantId: l.variant.id, quantity: l.quantity, expectedUnitPriceMinor: l.variant.priceMinor, discountMinor: l.discountMinor })),
      orderDiscountMinor: draft.orderDiscountMinor,
      discountReason: needsReason ? draft.discountReason.trim() : "",
      tenderedMinor,
    };
  };

  const succeed = (sale: PosSale) => {
    setDone(sale);
    setDraft(() => emptyDraft(), "cleanup");
    setTendered(""); setOutcome(null); setRecovery("idle"); setNote(null);
    invalidate();
    setFocusSignal((n) => n + 1);
  };

  const send = (payload: CashSaleInput) => {
    setOutcome(null); setRecovery("idle");
    create.mutate({ data: payload }, {
      onSuccess: succeed,
      onError: (e) => {
        const k = classify(e);
        setOutcome({ kind: k, e });
        invalidate();
        if (k === "conflict") checkRecovery();
      },
    });
  };

  const charge = () => {
    const p = buildPayload();
    if (!p) return;
    setConfirmOpen(false);
    // Persist the exact payload BEFORE the network call; fail closed if storage refuses.
    if (!setDraft((d) => ({ ...d, pending: p }), "arm")) return;
    setDone(null);
    send(p);
  };

  const checkRecovery = async () => {
    setRecovery("checking");
    const r = await recover.refetch();
    if (r.data) return succeed(r.data);
    if (statusOf(r.error) === 404) setRecovery("absent");
    else setRecovery("error");
  };

  /** Durable abandonment: only cancelled:true unlocks; cancelled:false means the sale exists. */
  const abandon = () => {
    if (!pending) return;
    if (!confirm("Demander au serveur d'annuler définitivement cette tentative ? Si la vente a déjà été enregistrée, son ticket s'affichera.")) return;
    setCancelErr(null);
    cancelSale.mutate({ data: { requestId: pending.requestId, registerSessionId: pending.registerSessionId } }, {
      onSuccess: (r) => {
        if (r.cancelled) {
          setDraft((d) => ({ ...d, pending: null }), "cleanup");
          setOutcome(null); setRecovery("idle");
          setNote({ tone: "warn", text: "Tentative annulée par le serveur : aucune vente ne sera enregistrée. Le panier est modifiable." });
          invalidate();
        } else if (r.sale) succeed(r.sale);
        else setCancelErr(new Error("Réponse d'annulation incomplète : la tentative reste verrouillée."));
      },
      onError: (e) => setCancelErr(e),
    });
  };

  const refreshPrices = async () => {
    setNote(null);
    const changes: string[] = [];
    const lines = [...draftRef.current.lines];
    for (let i = 0; i < lines.length; i++) {
      try {
        const v = await lookupPosBarcode({ barcode: lines[i].variant.barcode });
        if (v.priceMinor !== lines[i].variant.priceMinor) changes.push(`${v.sku} : ${formatDA(lines[i].variant.priceMinor)} vers ${formatDA(v.priceMinor)}`);
        if (v.available < lines[i].quantity) changes.push(`${v.sku} : ${v.available} disponible`);
        lines[i] = { ...lines[i], variant: v };
      } catch (e) { changes.push(`${lines[i].variant.sku} : ${errMsg(e)}`); }
    }
    setDraft((d) => ({ ...d, lines }));
    setNote({ tone: changes.length ? "warn" : "warn", text: changes.length ? `Vérifiez avec la cliente : ${changes.join(" · ")}` : "Prix et stock inchangés." });
  };

  if (!mine && !pending) {
    return (
      <>
        {done && <SaleDone sale={done} onDismiss={() => setDone(null)} />}
        <OpenRegisterPanel ctx={c} request={request} />
        {draft.lines.length > 0 && <p className="text-center text-xs text-muted-foreground mt-4">Votre panier en cours ({t.units} article(s)) est conservé dans cet onglet.</p>}
      </>
    );
  }

  const sessionMismatch = pending && (!s || s.id !== pending.registerSessionId || s.status !== "OPEN");

  return (
    <div className="grid lg:grid-cols-[1.35fr_1fr] gap-6 items-start">
      <div className="space-y-4 min-w-0">
        {done && <SaleDone sale={done} onDismiss={() => setDone(null)} />}
        <OpenRegisterPanel ctx={c} request={request} pendingOnly />
        <ScannerInput disabled={locked || !mine} onFound={addVariant} focusSignal={focusSignal} />
        {storageMsg && <p className="text-sm rounded-md px-3 py-2 border text-destructive bg-destructive/5 border-destructive/20" role="alert" data-testid="status-storage">{storageMsg}</p>}
        {note && <p className={`text-sm rounded-md px-3 py-2 border ${note.tone === "err" ? "text-destructive bg-destructive/5 border-destructive/20" : "text-[#8a4a24] bg-[#fbf1ea] border-secondary/30"}`} data-testid="status-pos-note">{note.text}</p>}
        <VariantSearch enabled={mine} disabled={locked} onPick={addVariant} inBasket={inBasket} />
      </div>

      <aside className="bg-card border border-border rounded-md lg:sticky lg:top-6 overflow-hidden" data-testid="panel-basket">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-[#f7e6ec]/40">
          <div className="flex items-center gap-2"><ShoppingBag className="w-4 h-4 text-primary" /><span className="font-serif text-xl">Panier</span>
            <span className="text-xs text-muted-foreground" data-testid="text-basket-count">{draft.lines.length}/{MAX_LINES} réf. · {t.units} art.</span></div>
          {draft.lines.length > 0 && !locked && (
            <button className="text-xs text-muted-foreground hover:text-destructive inline-flex items-center gap-1" data-testid="button-clear-basket"
              onClick={() => { if (confirm("Vider le panier ?")) setDraft(() => emptyDraft()); }}><Trash2 className="w-3 h-3" />Vider</button>
          )}
        </div>

        {pending && (
          <PendingBanner outcome={outcome} recovery={recovery} busy={create.isPending} sessionMismatch={!!sessionMismatch}
            onRetry={() => send(pending)} onCheck={checkRecovery} onAbandon={abandon} cancelling={cancelSale.isPending} cancelErr={cancelErr} />
        )}

        <div className="max-h-[42dvh] overflow-y-auto px-4">
          {draft.lines.length === 0 ? (
            <div className="py-12 text-center" data-testid="status-basket-empty">
              <div className="w-14 h-14 mx-auto rounded-full border border-dashed border-primary/40 grid place-items-center"><ShoppingBag className="w-5 h-5 text-primary/60" strokeWidth={1.4} /></div>
              <p className="font-serif text-2xl mt-3">Panier vide</p>
              <p className="text-xs text-muted-foreground mt-1">Scannez une étiquette pour commencer.</p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {draft.lines.map((l, i) => (
                <BasketLineRow key={l.variant.id} line={l} locked={locked} canManage={c.canManage}
                  onQty={(q) => setDraft((d) => { const lines = [...d.lines]; lines[i] = { ...lines[i], quantity: q }; return { ...d, lines }; })}
                  onDiscount={(m) => setDraft((d) => { const lines = [...d.lines]; lines[i] = { ...lines[i], discountMinor: m }; return { ...d, lines }; })}
                  onRemove={() => setDraft((d) => ({ ...d, lines: d.lines.filter((_, j) => j !== i) }))} />
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-border px-5 py-4 space-y-2 text-sm bg-[#fbf8f5]">
          <Row k="Sous-total" v={formatDA(t.gross)} />
          {t.lineDisc > 0 && <Row k="Remises lignes" v={`-${formatDA(t.lineDisc)}`} />}
          {c.canManage ? (
            <>
              <div className="flex items-center justify-between"><span className="text-muted-foreground">Remise ticket</span>
                <MoneyInput valueMinor={draft.orderDiscountMinor} disabled={locked} onCommit={(m) => setDraft((d) => ({ ...d, orderDiscountMinor: m }))} testId="input-order-discount" /></div>
              {needsReason && <input className={`${inputCls} !py-1.5 text-xs`} disabled={locked} maxLength={500} placeholder="Motif de la remise (obligatoire)"
                value={draft.discountReason} onChange={(e) => setDraft((d) => ({ ...d, discountReason: e.target.value }))} data-testid="input-discount-reason" />}
            </>
          ) : <p className="text-[11px] text-muted-foreground">Remises : réservées aux responsables.</p>}
          <div className="flex items-end justify-between pt-2 border-t border-dashed border-border">
            <span className="uppercase tracking-wider text-xs">Total estimé</span>
            <span className="font-serif text-4xl leading-none" data-testid="text-basket-total">{formatDA(t.net)}</span>
          </div>
          <div className="pt-2">
            <label className="text-xs uppercase tracking-wide text-muted-foreground">Espèces reçues</label>
            <input inputMode="decimal" disabled={locked || draft.lines.length === 0} value={tendered} onChange={(e) => setTendered(e.target.value)}
              className={`${inputCls} mt-1 font-mono text-lg`} placeholder="0,00" data-testid="input-tendered" />
            {t.net > 0 && !locked && (
              <div className="flex gap-1.5 mt-2 flex-wrap">
                {quickTenders(t.net).map((m) => (
                  <button key={m} onClick={() => setTendered((m / 100).toFixed(2).replace(".", ","))} className="px-2.5 py-1 rounded-full border border-border text-xs font-mono hover:border-primary hover:text-primary transition" data-testid={`button-tender-${m}`}>{formatDA(m)}</button>
                ))}
              </div>
            )}
          </div>
          {change !== null && draft.lines.length > 0 && (
            <div className={`flex justify-between items-center rounded-md px-3 py-2 ${change < 0 ? "bg-destructive/10 text-destructive" : "bg-[#282326] text-[#f6efe9]"}`}>
              <span className="text-xs uppercase tracking-wider">{change < 0 ? "Manque" : "Monnaie à rendre"}</span>
              <span className="font-mono text-lg" data-testid="text-change">{formatDA(Math.abs(change))}</span>
            </div>
          )}
          {!pending && draft.lines.length > 0 && problems.length > 0 && <p className="text-[11px] text-muted-foreground">{problems[0]}</p>}
          {!pending && draft.lines.length > 0 && (
            <button className={`${btnDark} w-full !py-3 text-base`} disabled={problems.length > 0 || create.isPending} onClick={() => setConfirmOpen(true)} data-testid="button-checkout">
              Encaisser {formatDA(t.net)}<ArrowRight className="w-4 h-4" />
            </button>
          )}
          {!pending && draft.lines.length > 0 && <button className="w-full text-xs text-muted-foreground hover:text-primary inline-flex justify-center items-center gap-1" onClick={refreshPrices} data-testid="button-refresh-prices"><RefreshCw className="w-3 h-3" />Revérifier prix et stock</button>}
          <p className="text-[10px] text-muted-foreground text-center">Montants estimés localement. Le serveur fixe les prix, totaux et stock définitifs.</p>
        </div>
      </aside>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-sm" dir="ltr">
          <DialogHeader>
            <DialogTitle className="font-serif text-3xl font-normal">Confirmer l'encaissement</DialogTitle>
            <DialogDescription>Vérifiez les espèces en main avant de valider.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 text-sm">
            <Row k={`${t.units} article(s)`} v={formatDA(t.gross)} />
            {t.discounts > 0 && <Row k="Remises" v={`-${formatDA(t.discounts)}`} />}
            <Row k="Total" v={formatDA(t.net)} strong />
            <Row k="Espèces reçues" v={tenderedMinor !== null ? formatDA(tenderedMinor) : "-"} />
            <Row k="Monnaie à rendre" v={change !== null ? formatDA(change) : "-"} strong />
          </div>
          <div className="flex gap-2 pt-3">
            <button className={btnGhost} onClick={() => setConfirmOpen(false)}>Retour</button>
            <button className={`${btnDark} flex-1`} autoFocus onClick={charge} data-testid="button-confirm-sale">Valider la vente</button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function quickTenders(net: number) {
  const out = new Set<number>([net]);
  for (const step of [50000, 100000, 200000]) out.add(Math.ceil(net / step) * step);
  return [...out].filter((m) => m <= 1_000_000_000).sort((a, b) => a - b).slice(0, 4);
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return <div className={`flex justify-between ${strong ? "font-semibold" : ""}`}><span className="text-muted-foreground">{k}</span><span className="font-mono">{v}</span></div>;
}

function PendingBanner({ outcome, recovery, busy, sessionMismatch, onRetry, onCheck, onAbandon, cancelling, cancelErr }: {
  outcome: { kind: Outcome; e: unknown } | null; recovery: string; busy: boolean; sessionMismatch: boolean;
  onRetry: () => void; onCheck: () => void; onAbandon: () => void; cancelling: boolean; cancelErr: unknown;
}) {
  if (busy) return (
    <div className="px-5 py-3 bg-accent/60 border-b border-primary/20 text-sm flex items-center gap-2" data-testid="status-sale-sending">
      <RefreshCw className="w-4 h-4 text-primary animate-spin" />Envoi au serveur… ne rechargez pas et ne relancez pas sur un autre poste.
    </div>
  );
  const conflict = outcome?.kind === "conflict";
  return (
    <div className="px-5 py-4 bg-[#fbf1ea] border-b border-secondary/30 text-sm space-y-2" data-testid="status-sale-pending">
      <p className="flex gap-2 font-medium"><AlertTriangle className="w-4 h-4 text-secondary shrink-0 mt-0.5" />
        {conflict ? "Conflit signalé par le serveur" : outcome?.kind === "auth" ? "Session de connexion expirée" : outcome?.kind === "rejected" ? "Vente refusée par le serveur" : "Résultat de la vente inconnu"}</p>
      <p className="text-xs text-foreground/80">
        {conflict ? "Le prix, le stock ou la demande a changé. Vérifiez d'abord si la vente existe déjà."
          : "Le panier est verrouillé avec la même demande. Vérifiez ou réessayez : aucun double encaissement ne sera créé."}
        {" "}Pour corriger le panier, annulez d'abord cette tentative : seul le serveur peut garantir qu'elle ne sera jamais encaissée.
      </p>
      {outcome?.e != null && <p className="text-xs text-destructive">{errMsg(outcome.e)}</p>}
      {sessionMismatch && <p className="text-xs text-destructive">La session de tiroir de cette tentative a changé ou été clôturée. La vente ne peut pas être finalisée dans un autre tiroir.</p>}
      {recovery === "absent" && <p className="text-xs">Aucune vente trouvée pour l'instant. Cela ne garantit pas qu'une requête en transit ne sera pas enregistrée plus tard.</p>}
      {recovery === "error" && <p className="text-xs text-destructive">Vérification impossible pour l'instant (réseau ou serveur).</p>}
      {cancelErr != null && <p className="text-xs text-destructive" data-testid="text-cancel-error">Annulation non confirmée, la tentative reste verrouillée : {errMsg(cancelErr)}</p>}
      <div className="flex flex-wrap gap-2 pt-1">
        <button className={`${btnDark} !px-3 !py-1.5 text-xs`} disabled={recovery === "checking" || cancelling} onClick={onCheck} data-testid="button-check-sale">{recovery === "checking" ? "Vérification…" : "Vérifier la vente"}</button>
        <button className={`${btnGhost} !px-3 !py-1.5 text-xs`} disabled={cancelling} onClick={onRetry} data-testid="button-retry-sale">Réessayer à l'identique</button>
        <button className={`${btnGhost} !px-3 !py-1.5 text-xs hover:!border-destructive hover:!text-destructive`} disabled={cancelling} onClick={onAbandon} data-testid="button-cancel-sale-request">{cancelling ? "Annulation…" : "Annuler cette tentative"}</button>
      </div>
    </div>
  );
}

function SaleDone({ sale, onDismiss }: { sale: PosSale; onDismiss: () => void }) {
  return (
    <div className="rounded-md border border-emerald-700/25 bg-emerald-50/70 p-4 flex flex-wrap items-center gap-4 rise" data-testid="status-sale-done">
      <CheckCircle2 className="w-7 h-7 text-emerald-700" strokeWidth={1.4} />
      <div className="flex-1 min-w-0">
        <p className="font-medium">Vente {sale.number} confirmée par le serveur</p>
        <p className="text-sm text-muted-foreground">Total {formatDA(sale.totalMinor)} · reçu {formatDA(sale.tenderedMinor)} · <span className="text-foreground font-semibold">monnaie {formatDA(sale.changeMinor)}</span></p>
      </div>
      <Link href={`/pos/tickets/${sale.id}`} className={btnDark} data-testid="link-sale-receipt"><ReceiptIcon className="w-4 h-4" />Ticket</Link>
      <button className="text-xs text-muted-foreground" onClick={onDismiss}>Masquer</button>
    </div>
  );
}
