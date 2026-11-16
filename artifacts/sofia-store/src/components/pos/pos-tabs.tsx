import { Link, useLocation } from "wouter";
import { usePos } from "@/lib/pos";
import { formatDA } from "@/lib/util";

export function PosTabs() {
  const [loc] = useLocation();
  const { ctx, user } = usePos();
  const c = ctx.data;
  const tabs = [
    { href: "/pos", label: "Encaisser" },
    { href: "/pos/historique", label: "Tickets" },
    { href: "/pos/sessions", label: "Tiroir" },
    ...(c?.canManage ? [{ href: "/pos/reglages", label: "Réglages ticket" }] : []),
  ];
  const s = c?.activeSession;
  return (
    <div className="flex flex-wrap items-center gap-3 mb-6 no-print">
      <div className="flex gap-1 p-1 rounded-full bg-muted/70 border border-border overflow-x-auto">
        {tabs.map((t) => {
          const on = t.href === "/pos" ? loc === "/pos" : loc.startsWith(t.href) || (t.href === "/pos/historique" && loc.startsWith("/pos/tickets"));
          return (
            <Link key={t.href} href={t.href} data-testid={`tab-pos-${t.href.split("/").pop()}`}
              className={`shrink-0 px-4 py-1.5 rounded-full text-sm transition-all ${on ? "bg-[#282326] text-[#f6efe9] shadow-sm" : "hover:text-primary"}`}>{t.label}</Link>
          );
        })}
      </div>
      {c && (
        <div className="ms-auto flex items-center gap-2 text-xs" data-testid="status-drawer">
          <span className={`w-2 h-2 rounded-full ${s ? "bg-emerald-600 animate-pulse" : "bg-muted-foreground/50"}`} />
          <span className="uppercase tracking-wider text-muted-foreground">{c.registerName}</span>
          {s ? (
            <span>· ouvert par {s.openedById === user?.id ? "vous" : s.openedBy} · attendu <span className="font-mono">{formatDA(s.expectedMinor)}</span></span>
          ) : <span>· fermé</span>}
        </div>
      )}
    </div>
  );
}
