import { type ReactNode } from "react";
import { parseMoney } from "@/lib/pos";
import { inputCls } from "@/components/admin/shell-primitives";

export const ORDER_STATUS: Record<string, [string, string]> = {
  PENDING: ["En attente", "bg-[#f7e6ec] text-[#a82d64]"],
  CONFIRMED: ["Confirmée", "bg-[#efe4f3] text-[#6b3480]"],
  PREPARING: ["En préparation", "bg-[#fbf1ea] text-[#a65429]"],
  READY: ["Prête", "bg-[#fdf3d8] text-[#7a5a0c]"],
  DISPATCHED: ["Expédiée", "bg-[#e3edf4] text-[#2c5675]"],
  DELIVERED: ["Livrée", "bg-[#e3f0ea] text-[#2f6b4f]"],
  COMPLETED: ["Terminée", "bg-[#282326] text-[#f6efe9]"],
  RETURNING: ["Retour en cours", "bg-[#fbe7e1] text-[#9a3a22]"],
  RETURNED: ["Retournée", "bg-[#f1e3de] text-[#7a3a2a]"],
  CANCELLED: ["Annulée", "bg-destructive/10 text-destructive"],
  EXPIRED: ["Expirée", "bg-muted text-muted-foreground"],
};
export const StatusBadge = ({ s }: { s: string }) => <span className={`text-xs px-2.5 py-1 rounded-full whitespace-nowrap ${ORDER_STATUS[s]?.[1] ?? "bg-muted"}`} data-testid="status-order">{ORDER_STATUS[s]?.[0] ?? s}</span>;

export const PAY_STATUS: Record<string, string> = { UNPAID: "Non encaissée", COLLECTED_BY_COURIER: "Chez le transporteur", PAID: "Reçue en boutique", REFUNDED: "Remboursée" };

export const GOODS: Record<string, string> = {
  PENDING: "En boutique · réservées", CONFIRMED: "En boutique · réservées", PREPARING: "En boutique · en préparation", READY: "En boutique · prêtes",
  DISPATCHED: "Sorties · chez le transporteur", DELIVERED: "Sorties · remises à la cliente", COMPLETED: "Sorties · chez la cliente",
  RETURNING: "Sorties · retour en route", RETURNED: "Revenues en boutique", CANCELLED: "Jamais sorties · réservation libérée", EXPIRED: "Jamais sorties · réservation libérée",
};

export const ACTION: Record<string, { label: string; hint: string; danger?: boolean }> = {
  CONFIRM: { label: "Confirmer", hint: "Arrête l'expiration. Choisissez qui encaissera la cliente." },
  PREPARE: { label: "Mettre en préparation", hint: "Les pièces sont sorties du stock réservé pour emballage." },
  READY: { label: "Marquer prête", hint: "Colis emballé (livraison) ou prêt au comptoir (retrait)." },
  DISPATCH: { label: "Remettre au transporteur", hint: "Les pièces quittent physiquement la boutique." },
  DELIVER: { label: "Marquer livrée", hint: "La cliente a reçu le colis. Aucun paiement n'est enregistré." },
  COURIER_COLLECT: { label: "Attester l'encaissement coursier", hint: "Le transporteur a encaissé la totalité auprès de la cliente. Aucun argent n'arrive encore en caisse." },
  RETURN_START: { label: "Ouvrir un retour", hint: "La commande entière revient vers la boutique." },
  RETURN_RECEIVE: { label: "Réceptionner le retour", hint: "Toutes les pièces sont physiquement revenues. Aucun remboursement automatique." },
  CANCEL: { label: "Annuler la commande", hint: "Avant expédition uniquement. Libère le stock réservé.", danger: true },
};

export function Flow({ icon, k, v, sub }: { icon: ReactNode; k: string; v: string; sub: ReactNode }) {
  return <div className="bg-card p-4"><p className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-2">{icon}{k}</p><p className="font-serif text-xl mt-1 leading-tight">{v}</p><div className="text-xs text-muted-foreground mt-2">{sub}</div></div>;
}
export function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return <div className={`flex justify-between gap-3 ${strong ? "font-medium" : ""}`}><dt className={strong ? "" : "text-muted-foreground"}>{k}</dt><dd className="tabular-nums font-mono text-[13px]">{v}</dd></div>;
}
export function Money({ label, value, onChange, testId }: { label: string; value: string; onChange: (v: string) => void; testId: string }) {
  return <label className="block text-xs text-muted-foreground">{label}<input inputMode="decimal" className={`${inputCls} mt-1 font-mono`} value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId} />{value.trim() && parseMoney(value) === null && <span className="text-destructive">Montant invalide.</span>}</label>;
}
export function Alert({ tone, testId, children }: { tone: "danger" | "info" | "ok"; testId: string; children: ReactNode }) {
  const c = tone === "danger" ? "border-destructive/30 bg-destructive/5 text-destructive" : tone === "ok" ? "border-[#2f6b4f]/30 bg-[#e3f0ea] text-[#2f6b4f]" : "border-[#d98c62]/30 bg-[#fbf1ea] text-[#8a4a24]";
  return <div role={tone === "danger" ? "alert" : "status"} className={`text-sm rounded-md px-4 py-3 border ${c}`} data-testid={testId}>{children}</div>;
}

