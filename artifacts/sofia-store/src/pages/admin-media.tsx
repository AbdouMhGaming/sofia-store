import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ImageOff, RefreshCw, Trash2, UploadCloud } from "lucide-react";
import {
  useListMedia, useRequestUploadUrl, useCompleteMedia, useDeleteMedia, getListMediaQueryKey,
  type UploadInputContentType,
} from "@workspace/api-client-react";
import { useSessionCsrf } from "@/lib/auth";
import { errMsg } from "@/lib/util";
import { AdminShell, ErrorText, Skel, btnDark, btnGhost, useInvalidateCatalog } from "@/pages/admin";
import { thumbOf } from "@/components/admin/media-picker";

const TYPES: string[] = ["image/jpeg", "image/png", "image/webp"];
const MAX = 8 * 1024 * 1024;

function fmtBytes(b: number) {
  return b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} Ko` : `${(b / 1024 / 1024).toFixed(2)} Mo`;
}

type Job = { name: string; state: "pending" | "done" | "error"; msg?: string };

export function AdminMediaPage() {
  const { session, token } = useSessionCsrf();
  const enabled = !!session.data?.user && !session.data.user.mustChangePassword;
  const q = useListMedia({ query: { queryKey: getListMediaQueryKey(), enabled } });
  const headers = { "x-csrf-token": token };
  const jsonHeaders = { "x-csrf-token": token, "Content-Type": "application/json" };
  const requestUpload = useRequestUploadUrl({ request: { headers } });
  const complete = useCompleteMedia({ request: { headers: jsonHeaders } });
  const del = useDeleteMedia({ request: { headers: jsonHeaders } });
  const qc = useQueryClient();
  const invalidateCatalog = useInvalidateCatalog();
  const fileRef = useRef<HTMLInputElement>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [busy, setBusy] = useState(false);

  const upload = async (files: File[]) => {
    setBusy(true);
    const initial: Job[] = files.map((f) => ({ name: f.name, state: "pending" }));
    setJobs(initial);
    const setJob = (i: number, j: Partial<Job>) => setJobs((all) => all.map((x, k) => (k === i ? { ...x, ...j } : x)));
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      try {
        if (!TYPES.includes(f.type)) throw new Error("Format refusé : JPEG, PNG ou WebP uniquement.");
        if (f.size > MAX) throw new Error("Fichier trop lourd : 8 Mo maximum.");
        if (f.size < 1) throw new Error("Fichier vide.");
        const ticket = await requestUpload.mutateAsync({ data: { name: f.name.slice(0, 190), size: f.size, contentType: f.type as UploadInputContentType } });
        const put = await fetch(ticket.uploadURL, { method: "PUT", body: f, headers: { "Content-Type": f.type } });
        if (!put.ok) throw new Error(`Envoi refusé par le stockage (${put.status}).`);
        await complete.mutateAsync({ id: ticket.uploadId });
        setJob(i, { state: "done" });
      } catch (e) {
        setJob(i, { state: "error", msg: errMsg(e) });
      }
    }
    qc.invalidateQueries({ queryKey: getListMediaQueryKey() });
    invalidateCatalog();
    setBusy(false);
  };

  const lib = q.data;
  return (
    <AdminShell title="Médiathèque" sub="Photos téléversées, validées et réencodées par le serveur."
      actions={
        <>
          <input ref={fileRef} type="file" multiple accept="image/jpeg,image/png,image/webp" className="hidden" data-testid="input-media-file"
            onChange={(e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ""; if (fs.length) upload(fs); }} />
          <button className={btnDark} disabled={busy || !lib?.enabled} onClick={() => fileRef.current?.click()} data-testid="button-upload-media">
            <UploadCloud className="w-4 h-4" />{busy ? "Téléversement…" : "Téléverser"}
          </button>
        </>
      }>
      {jobs.length > 0 && (
        <div className="mb-6 bg-card border border-border rounded-md divide-y divide-border" data-testid="list-upload-jobs">
          {jobs.map((j, i) => (
            <div key={i} className="px-4 py-2.5 flex items-center gap-3 text-sm">
              <span className={`w-2 h-2 rounded-full ${j.state === "done" ? "bg-primary" : j.state === "error" ? "bg-destructive" : "bg-secondary animate-pulse"}`} />
              <span className="flex-1 truncate">{j.name}</span>
              <span className={`text-xs ${j.state === "error" ? "text-destructive" : "text-muted-foreground"}`} data-testid={`status-upload-${i}`}>
                {j.state === "done" ? "Ajoutée" : j.state === "error" ? j.msg : "En cours…"}
              </span>
            </div>
          ))}
        </div>
      )}
      {del.error && <div className="mb-4"><ErrorText e={del.error} /></div>}
      {q.isLoading || !enabled ? <Skel h="h-72" /> : q.isError ? (
        <><ErrorText e={q.error} /><button className={`${btnGhost} mt-3`} onClick={() => q.refetch()}>Réessayer</button></>
      ) : !lib?.enabled ? (
        <div className="max-w-xl rounded-md border border-secondary/40 bg-[#fbf1ea] p-6" data-testid="status-media-disabled">
          <div className="flex gap-3">
            <AlertTriangle className="w-5 h-5 text-secondary shrink-0 mt-0.5" />
            <div>
              <p className="font-serif text-2xl">Stockage indisponible</p>
              <p className="text-sm text-muted-foreground mt-1">Le stockage des photos n'est pas configuré ou ne répond pas. Aucun fichier ne peut être téléversé pour l'instant. Les photos fournies restent utilisables dans les fiches produits.</p>
              <button className={`${btnGhost} mt-4`} onClick={() => q.refetch()} disabled={q.isFetching} data-testid="button-retry-media"><RefreshCw className="w-3.5 h-3.5" />Vérifier à nouveau</button>
            </div>
          </div>
        </div>
      ) : lib.items.length === 0 ? (
        <div className="border border-dashed border-border rounded-md py-16 text-center" data-testid="status-media-empty">
          <ImageOff className="w-8 h-8 mx-auto text-primary/50" strokeWidth={1.2} />
          <p className="font-serif text-2xl mt-3">Aucune photo pour l'instant.</p>
          <p className="text-sm text-muted-foreground mt-1">JPEG, PNG ou WebP, 8 Mo maximum par fichier.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {lib.items.map((m) => (
            <figure key={m.id} className="group bg-card border border-border rounded-md overflow-hidden" data-testid={`card-media-${m.id}`}>
              <div className="aspect-[3/4] bg-muted overflow-hidden"><img src={thumbOf(m.path)} alt={m.name} loading="lazy" className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-500" /></div>
              <figcaption className="p-3">
                <p className="text-sm truncate" title={m.name}>{m.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">{m.width}×{m.height} · {fmtBytes(m.bytes)}</p>
                <button className={`${btnGhost} !px-3 !py-1 text-xs mt-2 w-full`} disabled={del.isPending} data-testid={`button-delete-media-${m.id}`}
                  onClick={() => {
                    if (!confirm(`Supprimer « ${m.name} » ? Impossible si la photo est utilisée par un produit.`)) return;
                    del.mutate({ id: m.id }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getListMediaQueryKey() }); invalidateCatalog(); } });
                  }}><Trash2 className="w-3 h-3" />Supprimer</button>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </AdminShell>
  );
}
