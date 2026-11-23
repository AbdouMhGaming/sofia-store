import { useEffect, useRef, useState } from "react";
import { Redirect, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Copy, KeyRound, Lock, Pencil, RotateCw, ShieldCheck, UserPlus, Users, Wallet, XCircle } from "lucide-react";
import {
  useListStaff, getListStaffQueryKey, useExecuteStaffCommand, useRecoverStaffCommand, getRecoverStaffCommandQueryKey, useAbandonStaffCommand,
  type StaffCommandInput, type StaffCommandResult, type StaffRow, type StaffRole,
} from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useSessionCsrf } from "@/lib/auth";
import { errMsg } from "@/lib/util";
import { readPending, savePending, clearPending, validateInput, pendingKey, type PendingRead } from "@/lib/staff-pending";
import { AdminShell } from "@/pages/admin";
import { inputCls, btnDark, btnGhost, Field, ErrorText, Skel } from "@/components/admin/shell-primitives";

const ROLE_LABEL: Record<StaffRole, string> = { MANAGER: "Gérant(e)", CASHIER: "Caissier(ère)" };
const KIND_LABEL: Record<StaffCommandInput["kind"], string> = { CREATE: "Création de compte", UPDATE: "Modification rôle / état", RESET: "Réinitialisation du mot de passe" };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Credential = { requestId: string; email: string; password: string; kind: "CREATE" | "RESET" };
type Notice = { tone: "ok" | "info" | "warn"; text: string };
type FormMode = { mode: "create" } | { mode: "edit"; row: StaffRow } | { mode: "reset"; row: StaffRow };

function statusOf(e: unknown): number | undefined {
  const s = (e as { status?: unknown } | null)?.status;
  return typeof s === "number" ? s : undefined;
}

export function AdminStaffPage() {
  const { session } = useSessionCsrf();
  const user = session.data?.user;
  const owner = !!user && user.role === "STORE_OWNER" && !user.mustChangePassword;
  if (user && !user.mustChangePassword && user.role === "MANAGER") return <Redirect to="/admin" />;
  return (
    <AdminShell title="Équipe" sub="Comptes gérants et caissiers. Seule la propriétaire y a accès.">
      {owner && user ? <StaffWorkspace key={user.id} actorId={user.id} /> : <Skel h="h-64" />}
    </AdminShell>
  );
}

function StaffWorkspace({ actorId }: { actorId: number }) {
  const { request } = useSessionCsrf();
  const qc = useQueryClient();
  const list = useListStaff({ query: { queryKey: getListStaffQueryKey(), enabled: true } });
  const exec = useExecuteStaffCommand({ request, mutation: { gcTime: 0, retry: false } });
  const abandon = useAbandonStaffCommand({ request });
  const execReset = useRef(exec.reset); execReset.current = exec.reset;

  const [pending, setPending] = useState<PendingRead>(() => readPending(actorId));
  const pendingInput = pending.state === "ok" ? pending.input : null;
  const recover = useRecoverStaffCommand(pendingInput?.requestId ?? "", {
    query: { queryKey: getRecoverStaffCommandQueryKey(pendingInput?.requestId ?? ""), enabled: false, gcTime: 0, retry: false },
  });

  const [credential, setCredential] = useState<Credential | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState<"send" | "recover" | "abandon" | null>(null);
  const [cmdError, setCmdError] = useState<{ text: string; status?: number } | null>(null);
  const [unremoved, setUnremoved] = useState<StaffCommandInput | null>(null);
  const credRef = useRef<Credential | null>(null); credRef.current = credential;
  const [form, setForm] = useState<FormMode | null>(null);

  useEffect(() => {
    setPending(readPending(actorId));
    const h = (e: StorageEvent) => { if (e.key === null || e.key === pendingKey(actorId)) setPending(readPending(actorId)); };
    window.addEventListener("storage", h);
    return () => window.removeEventListener("storage", h);
  }, [actorId]);
  useEffect(() => {
    if (!credential) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [credential]);

  const blocked = pending.state !== "none" || !!credential || !!unremoved;

  const resolve = async (r: StaffCommandResult, input: StaffCommandInput, fromOriginal: boolean) => {
    if (r.requestId !== input.requestId) { setCmdError({ text: "Réponse inattendue du serveur (identifiant différent). L'opération reste en attente." }); return; }
    if (fromOriginal && r.status === "COMMITTED" && r.temporaryPassword && (r.kind === "CREATE" || r.kind === "RESET")) {
      setCredential({ requestId: r.requestId, email: r.staff?.email ?? (input.kind === "CREATE" ? input.email : ""), password: r.temporaryPassword, kind: r.kind });
    }
    if (r.status === "COMMITTED") {
      const shown = credRef.current?.requestId === r.requestId || (fromOriginal && !!r.temporaryPassword);
      const lost = (r.kind === "CREATE" || r.kind === "RESET") && !r.temporaryPassword && !shown;
      setNotice(lost
        ? { tone: "warn", text: `${KIND_LABEL[r.kind]} : opération terminée côté serveur. Le mot de passe temporaire d'origine ne peut pas être récupéré. Lancez explicitement une nouvelle réinitialisation pour ce compte si personne ne l'a noté.` }
        : { tone: "ok", text: `${KIND_LABEL[r.kind]} : opération terminée. Les sessions du compte concerné ont été fermées.` });
      qc.invalidateQueries({ queryKey: getListStaffQueryKey() });
    } else {
      setNotice({ tone: "info", text: `${KIND_LABEL[r.kind]} : opération annulée de façon définitive. Aucun changement n'a été appliqué.` });
    }
    setCmdError(null);
    await finishClear(input);
  };

  const finishClear = async (confirmed: StaffCommandInput) => {
    const ok = await clearPending(actorId, confirmed);
    setUnremoved(ok ? null : confirmed);
    setPending(readPending(actorId));
  };

  const send = async (input: StaffCommandInput) => {
    setBusy("send"); setCmdError(null);
    try {
      const r = await exec.mutateAsync({ data: input });
      execReset.current();
      await resolve(r, input, true);
    } catch (e) {
      execReset.current();
      const st = statusOf(e);
      setCmdError({ status: st, text: st === 409
        ? `Conflit : le compte a changé depuis l'ouverture du formulaire, ou un tiroir est ouvert. ${errMsg(e)}`
        : st === 400 || st === 422 ? `Données refusées par le serveur : ${errMsg(e)}` : `Résultat incertain : ${errMsg(e) || "réseau indisponible"}.` });
    } finally { setBusy(null); }
  };

  const start = async (input: StaffCommandInput) => {
    if (blocked) return false;
    const saved = await savePending(actorId, input);
    if (!saved.ok) {
      setPending(readPending(actorId));
      setCmdError({ text: saved.reason === "locks"
        ? "Ce navigateur ne permet pas de verrouiller les opérations entre onglets (connexion sécurisée et navigateur récent requis). Rien n'a été envoyé."
        : saved.reason === "exists" ? "Une autre opération d'équipe est déjà en attente (peut-être dans un autre onglet). Rien n'a été envoyé ; résolvez-la d'abord."
        : "Impossible d'enregistrer la trace de sécurité sur cet appareil. Rien n'a été envoyé. Vérifiez que le stockage du navigateur est autorisé." });
      return false;
    }
    setPending({ state: "ok", input });
    setNotice(null); setForm(null);
    await send(input);
    return true;
  };

  const doRecover = async () => {
    if (!pendingInput) return;
    setBusy("recover"); setCmdError(null);
    try {
      const res = await recover.refetch();
      if (!res.error && res.data) await resolve(res.data, pendingInput, false);
      else {
        const st = statusOf(res.error);
        setCmdError({ status: st, text: st === 404
          ? "Le serveur ne connaît pas encore cette opération. Cela ne signifie pas qu'elle est annulée : renvoyez-la à l'identique ou abandonnez-la explicitement."
          : `Vérification impossible : ${errMsg(res.error)}` });
      }
      qc.removeQueries({ queryKey: getRecoverStaffCommandQueryKey(pendingInput.requestId) });
    } finally { setBusy(null); }
  };

  const doAbandon = async () => {
    if (!pendingInput) return;
    if (!confirm("Abandonner cette opération ? Le serveur confirmera soit qu'elle était déjà terminée, soit qu'elle est annulée définitivement.")) return;
    setBusy("abandon"); setCmdError(null);
    try {
      const r = await abandon.mutateAsync({ data: pendingInput });
      abandon.reset();
      await resolve(r, pendingInput, false);
    } catch (e) {
      abandon.reset();
      setCmdError({ status: statusOf(e), text: `Abandon non confirmé : ${errMsg(e)}. L'opération reste en attente.` });
    } finally { setBusy(null); }
  };

  const retryRemoval = async () => { if (unremoved) await finishClear(unremoved); };

  const rows = list.data?.staff ?? [];

  return (
    <div className="space-y-6">
      {credential && <CredentialPanel c={credential} onDone={() => setCredential(null)} />}

      {notice && (
        <div data-testid="status-staff-notice" className={`rounded-md border p-4 text-sm flex gap-3 ${notice.tone === "ok" ? "border-primary/25 bg-[#f7e6ec]/60" : notice.tone === "warn" ? "border-secondary/40 bg-[#fbf1ea]" : "border-border bg-card"}`}>
          {notice.tone === "ok" ? <ShieldCheck className="w-4 h-4 text-primary shrink-0 mt-0.5" /> : notice.tone === "warn" ? <AlertTriangle className="w-4 h-4 text-secondary shrink-0 mt-0.5" /> : <XCircle className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />}
          <p className="flex-1">{notice.text}</p>
          <button className="text-xs text-muted-foreground hover:text-primary" onClick={() => setNotice(null)} data-testid="button-dismiss-notice">Fermer</button>
        </div>
      )}

      {pending.state === "bad" && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-5 text-sm space-y-3" data-testid="status-pending-unreadable">
          <p className="font-medium flex items-center gap-2"><Lock className="w-4 h-4 text-destructive" />Opération en attente illisible</p>
          <p>{pending.why} Par sécurité, toute nouvelle opération d'équipe est bloquée sur cet appareil. La trace n'est jamais supprimée automatiquement : vérifiez la liste et le journal d'activité, puis contactez le support technique.</p>
          <Link href="/admin/activite" className={btnGhost}>Ouvrir le journal d'activité</Link>
        </div>
      )}

      {pendingInput && (
        <PendingPanel input={pendingInput} busy={busy} error={cmdError} removalFailed={!!unremoved && sameReq(unremoved, pendingInput)}
          onRetry={() => send(pendingInput)} onRecover={doRecover} onAbandon={doAbandon} onRetryRemoval={retryRemoval} />
      )}

      {!pendingInput && cmdError && <ErrorBox text={cmdError.text} />}
      {unremoved && !(pendingInput && sameReq(unremoved, pendingInput)) && (
        <div className="text-sm rounded-md border border-secondary/40 bg-[#fbf1ea] p-3 space-y-2" data-testid="status-removal-failed">
          <p>Le résultat de l'opération {unremoved.requestId} est connu, mais sa trace locale n'a pas pu être effacée. Les opérations restent bloquées.</p>
          <button className={btnGhost} onClick={retryRemoval} data-testid="button-retry-removal-standalone">Réessayer l'effacement</button>
        </div>
      )}
      {credential && <p className="text-xs text-muted-foreground" data-testid="status-credential-blocking">Les nouvelles opérations sont bloquées tant que le mot de passe affiché n'a pas été confirmé comme transmis.</p>}

      <section className="bg-card border border-border rounded-md">
        <header className="flex flex-wrap items-center justify-between gap-3 p-5 border-b border-border">
          <div>
            <h2 className="font-serif text-2xl">Comptes de l'équipe</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Les comptes propriétaires ne sont jamais listés ici et ne peuvent être ni modifiés ni supprimés. Aucun compte n'est supprimé : on le désactive.</p>
          </div>
          <button className={btnDark} disabled={blocked || !!busy} onClick={() => { setCmdError(null); setForm({ mode: "create" }); }} data-testid="button-new-staff">
            <UserPlus className="w-4 h-4" />Nouveau compte
          </button>
        </header>
        {list.isLoading ? <div className="p-5"><Skel h="h-48" /></div>
          : list.isError ? <div className="p-5 space-y-3"><ErrorText e={list.error} /><button className={btnGhost} onClick={() => list.refetch()} data-testid="button-retry-staff">Réessayer</button></div>
          : rows.length === 0 ? (
            <div className="py-16 px-6 text-center" data-testid="status-staff-empty">
              <Users className="w-8 h-8 mx-auto text-primary/50" strokeWidth={1.2} />
              <p className="font-serif text-2xl mt-3">Personne d'autre pour l'instant.</p>
              <p className="text-sm text-muted-foreground mt-1">Créez un compte caissier pour confier la caisse sans partager vos accès.</p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((r) => <StaffRowItem key={r.id} r={r} disabled={blocked || !!busy}
                onEdit={() => { setCmdError(null); setForm({ mode: "edit", row: r }); }}
                onReset={() => { setCmdError(null); setForm({ mode: "reset", row: r }); }} />)}
            </ul>
          )}
      </section>

      <p className="text-xs text-muted-foreground max-w-2xl">Toute modification ferme immédiatement les sessions du compte concerné. Un nouveau compte ou un mot de passe réinitialisé doit être remplacé à la première connexion.</p>

      <StaffForm form={form} onClose={() => setForm(null)} onSubmit={start} blocked={blocked} />
    </div>
  );
}

function sameReq(a: StaffCommandInput, b: StaffCommandInput) { return a.requestId === b.requestId; }

function ErrorBox({ text }: { text: string }) {
  return <p className="text-sm text-destructive bg-destructive/5 border border-destructive/20 rounded-md px-3 py-2" data-testid="text-command-error">{text}</p>;
}

function StaffRowItem({ r, disabled, onEdit, onReset }: { r: StaffRow; disabled: boolean; onEdit: () => void; onReset: () => void }) {
  const drawer = r.openRegisterSessionId !== null;
  return (
    <li className="p-4 md:px-5 flex flex-wrap items-center gap-3" data-testid={`row-staff-${r.id}`}>
      <div className={`w-10 h-10 rounded-full grid place-items-center font-serif text-lg shrink-0 ${r.active ? "bg-[#282326] text-[#f6efe9]" : "bg-muted text-muted-foreground"}`}>
        {r.email.slice(0, 1).toUpperCase()}
      </div>
      <div className="flex-1 min-w-[180px]">
        <p className="font-medium break-all" data-testid={`text-staff-email-${r.id}`}>{r.email}</p>
        <div className="flex flex-wrap gap-1.5 mt-1">
          <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border border-primary/40 text-primary">{ROLE_LABEL[r.role]}</span>
          <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full ${r.active ? "bg-[#f7e6ec] text-[#a82d64]" : "bg-muted text-muted-foreground"}`} data-testid={`status-staff-active-${r.id}`}>{r.active ? "Actif" : "Désactivé"}</span>
          {r.mustChangePassword && <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#fbf1ea] text-[#a65429]">Mot de passe à changer</span>}
          {drawer && <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#282326] text-[#f6efe9]" data-testid={`status-staff-drawer-${r.id}`}>Tiroir ouvert n°{r.openRegisterSessionId}</span>}
        </div>
        <p className="text-xs text-muted-foreground mt-1">Créé le {new Date(r.createdAt).toLocaleDateString("fr-FR")} · version {r.version}</p>
        {drawer && <p className="text-xs text-secondary mt-1.5 flex items-center gap-1.5"><Wallet className="w-3 h-3" />Clôturez d'abord ce tiroir depuis <Link href="/pos/sessions" className="underline">Caisse / Tiroir</Link>. Aucune clôture automatique.</p>}
      </div>
      <div className="flex gap-2 w-full sm:w-auto">
        <button className={`${btnGhost} flex-1 sm:flex-none`} disabled={disabled || drawer} onClick={onEdit} data-testid={`button-edit-staff-${r.id}`}><Pencil className="w-3.5 h-3.5" />Rôle / état</button>
        <button className={`${btnGhost} flex-1 sm:flex-none`} disabled={disabled || drawer} onClick={onReset} data-testid={`button-reset-staff-${r.id}`}><KeyRound className="w-3.5 h-3.5" />Réinitialiser</button>
      </div>
    </li>
  );
}

function describe(i: StaffCommandInput) {
  if (i.kind === "CREATE") return `${i.email} · ${ROLE_LABEL[i.role]}`;
  if (i.kind === "UPDATE") return `Compte n°${i.userId} (version ${i.version}) → ${ROLE_LABEL[i.role]}, ${i.active ? "actif" : "désactivé"}`;
  return `Compte n°${i.userId} (version ${i.version})`;
}

function PendingPanel({ input, busy, error, removalFailed, onRetry, onRecover, onAbandon, onRetryRemoval }: {
  input: StaffCommandInput; busy: string | null; error: { text: string; status?: number } | null; removalFailed: boolean;
  onRetry: () => void; onRecover: () => void; onAbandon: () => void; onRetryRemoval: () => void;
}) {
  return (
    <section className="rounded-md border-2 border-[#282326] bg-card p-5 space-y-4" data-testid="panel-staff-pending">
      <div className="flex items-start gap-3">
        <Lock className="w-5 h-5 text-primary shrink-0 mt-0.5" />
        <div>
          <p className="eyebrow">Opération en attente de confirmation</p>
          <p className="font-serif text-2xl mt-1">{KIND_LABEL[input.kind]}</p>
          <p className="text-sm mt-1 break-all" data-testid="text-pending-summary">{describe(input)}</p>
          <p className="text-xs text-muted-foreground mt-1">Motif : {input.reason}</p>
          <p className="text-[11px] text-muted-foreground mt-1 font-mono break-all">Réf. {input.requestId}</p>
        </div>
      </div>
      {busy === "send" ? <p className="text-sm text-muted-foreground" data-testid="status-pending-sending">Envoi en cours…</p> : (
        <p className="text-sm text-foreground/80">Tant que le serveur n'a pas confirmé le résultat, les autres opérations d'équipe restent bloquées. Vous pouvez renvoyer exactement la même demande, vérifier son état, ou l'abandonner explicitement.</p>
      )}
      {error && <ErrorBox text={error.text} />}
      {removalFailed && (
        <div className="text-sm rounded-md border border-secondary/40 bg-[#fbf1ea] p-3 space-y-2">
          <p>Le résultat est connu, mais la trace locale n'a pas pu être effacée. Les opérations restent bloquées jusqu'à son effacement.</p>
          <button className={btnGhost} onClick={onRetryRemoval} data-testid="button-retry-removal">Réessayer l'effacement</button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button className={btnDark} disabled={!!busy} onClick={onRetry} data-testid="button-pending-retry"><RotateCw className="w-4 h-4" />Renvoyer à l'identique</button>
        <button className={btnGhost} disabled={!!busy} onClick={onRecover} data-testid="button-pending-recover">{busy === "recover" ? "Vérification…" : "Vérifier l'état"}</button>
        <button className={`${btnGhost} hover:!border-destructive hover:!text-destructive`} disabled={!!busy} onClick={onAbandon} data-testid="button-pending-abandon">{busy === "abandon" ? "Abandon…" : "Abandonner"}</button>
      </div>
    </section>
  );
}

function CredentialPanel({ c, onDone }: { c: Credential; onDone: () => void }) {
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);
  const [ack, setAck] = useState(false);
  return (
    <section className="rounded-md bg-[#282326] text-[#f6efe9] p-5 md:p-6 space-y-4" data-testid="panel-credential">
      <div className="flex items-start gap-3">
        <KeyRound className="w-5 h-5 text-primary shrink-0 mt-1" />
        <div>
          <p className="font-serif text-2xl">{c.kind === "CREATE" ? "Compte créé" : "Mot de passe réinitialisé"}</p>
          <p className="text-sm opacity-80 mt-1">Affiché une seule fois. Il n'est conservé nulle part et ne pourra pas être récupéré. S'il est perdu, il faudra lancer une nouvelle réinitialisation.</p>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] items-end">
        <div>
          <p className="text-[10px] uppercase tracking-[.2em] opacity-60">{c.email}</p>
          <code className="block mt-1 px-3 py-2.5 rounded-md bg-[#f6efe9]/10 font-mono text-base break-all select-all" data-testid="text-temp-password">{c.password}</code>
        </div>
        <button className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-full border border-[#f6efe9]/30 text-sm hover:border-primary hover:text-primary transition-colors"
          aria-label="Copier le mot de passe temporaire" data-testid="button-copy-password"
          onClick={async () => { try { await navigator.clipboard.writeText(c.password); setCopied("ok"); } catch { setCopied("fail"); } }}>
          {copied === "ok" ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}{copied === "ok" ? "Copié" : "Copier le mot de passe"}
        </button>
      </div>
      {copied === "fail" && <p className="text-sm text-[#f3b7a0]" data-testid="text-copy-failed">Copie impossible sur cet appareil. Recopiez-le à la main.</p>}
      <label className="flex items-start gap-3 text-sm cursor-pointer">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="accent-[#F04F94] w-4 h-4 mt-0.5" data-testid="checkbox-ack-credential" />
        J'ai transmis ce mot de passe à la personne concernée. Elle devra le changer à sa première connexion.
      </label>
      <button className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-primary text-[#f6efe9] text-sm disabled:opacity-40" disabled={!ack} onClick={onDone} data-testid="button-ack-credential">
        Effacer de l'écran
      </button>
    </section>
  );
}

function StaffForm({ form, onClose, onSubmit, blocked }: { form: FormMode | null; onClose: () => void; onSubmit: (i: StaffCommandInput) => Promise<boolean>; blocked: boolean }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffRole>("CASHIER");
  const [active, setActive] = useState(true);
  const [reason, setReason] = useState("");
  const [local, setLocal] = useState("");
  const [sending, setSending] = useState(false);
  useEffect(() => {
    setLocal(""); setReason(""); setEmail("");
    if (form?.mode === "edit") { setRole(form.row.role); setActive(form.row.active); }
    else { setRole("CASHIER"); setActive(true); }
  }, [form]);
  if (!form) return null;
  const row = form.mode === "create" ? null : form.row;
  const submit = async () => {
    setLocal("");
    const rs = reason.trim();
    if (rs.length < 3 || rs.length > 400) return setLocal("Le motif doit contenir entre 3 et 400 caractères.");
    if (row && row.openRegisterSessionId !== null) return setLocal("Un tiroir est ouvert pour ce compte. Clôturez-le d'abord depuis Caisse / Tiroir.");
    let input: StaffCommandInput;
    const requestId = crypto.randomUUID();
    if (form.mode === "create") {
      const em = email.trim().toLowerCase();
      if (em.length > 190 || !EMAIL.test(em)) return setLocal("Adresse e-mail invalide (190 caractères maximum).");
      input = { kind: "CREATE", requestId, email: em, role, reason: rs };
    } else if (form.mode === "edit") {
      if (role === form.row.role && active === form.row.active) return setLocal("Aucun changement : modifiez le rôle ou l'état.");
      input = { kind: "UPDATE", requestId, userId: form.row.id, version: form.row.version, role, active, reason: rs };
    } else {
      input = { kind: "RESET", requestId, userId: form.row.id, version: form.row.version, reason: rs };
    }
    if (!validateInput(input)) return setLocal("Données invalides.");
    setSending(true);
    try { await onSubmit(input); } finally { setSending(false); }
  };
  const title = form.mode === "create" ? "Nouveau compte" : form.mode === "edit" ? "Rôle et état" : "Réinitialiser le mot de passe";
  return (
    <Dialog open onOpenChange={(o) => !o && !sending && onClose()}>
      <DialogContent className="max-w-lg max-h-[90dvh] overflow-y-auto" dir="ltr">
        <DialogHeader>
          <DialogTitle className="font-serif text-3xl font-normal">{title}</DialogTitle>
          <DialogDescription>
            {row ? <>Compte <span className="font-medium text-foreground break-all">{row.email}</span>, version {row.version} au moment de l'ouverture. Si le compte change entre-temps, le serveur refusera.</>
              : "Un mot de passe temporaire sera généré et affiché une seule fois."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {form.mode === "create" && (
            <Field label="E-mail"><input type="email" maxLength={190} className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} disabled={blocked} data-testid="input-staff-email" /></Field>
          )}
          {form.mode !== "reset" && (
            <Field label="Rôle">
              <select className={inputCls} value={role} onChange={(e) => setRole(e.target.value as StaffRole)} disabled={blocked} data-testid="select-staff-role">
                <option value="CASHIER">{ROLE_LABEL.CASHIER} : caisse et tiroir</option>
                <option value="MANAGER">{ROLE_LABEL.MANAGER} : catalogue, stock et commandes</option>
              </select>
            </Field>
          )}
          {form.mode === "edit" && (
            <label className="flex items-center gap-3 text-sm cursor-pointer">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} disabled={blocked} className="accent-[#F04F94] w-4 h-4" data-testid="checkbox-staff-active" />
              Compte actif (décocher pour bloquer toute connexion)
            </label>
          )}
          {form.mode === "reset" && (
            <div className="rounded-md border border-secondary/40 bg-[#fbf1ea] p-3 text-sm">
              L'ancien mot de passe cessera de fonctionner et ses sessions seront fermées.{row && !row.active && " Ce compte est désactivé : la réinitialisation ne le réactive pas."}
            </div>
          )}
          <Field label="Motif" hint={`${reason.trim().length}/400 · 3 caractères minimum, conservé au journal`}>
            <textarea rows={3} maxLength={400} className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} disabled={blocked} data-testid="input-staff-reason" />
          </Field>
          {local && <p className="text-sm text-destructive" data-testid="text-form-error">{local}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button className={btnGhost} onClick={onClose} disabled={sending}>Annuler</button>
            <button className={btnDark} disabled={sending || blocked} onClick={submit} data-testid="button-submit-staff">{sending ? "Envoi…" : "Confirmer"}</button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
