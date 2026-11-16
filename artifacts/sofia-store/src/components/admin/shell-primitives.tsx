import type { ReactNode } from "react";
import { errMsg } from "@/lib/util";

export const inputCls = "w-full px-3.5 py-2.5 rounded-md bg-background border border-input text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition";
export const btnDark = "inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-full bg-[#282326] text-[#f6efe9] text-sm hover:bg-primary transition-colors disabled:opacity-50 disabled:pointer-events-none";
export const btnGhost = "inline-flex items-center justify-center gap-2 px-4 py-2 rounded-full border border-border text-sm hover:border-primary hover:text-primary transition-colors disabled:opacity-50";

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs tracking-wide uppercase text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

export function ErrorText({ e }: { e: unknown }) {
  if (!e) return null;
  return <p className="text-sm text-destructive bg-destructive/5 border border-destructive/20 rounded-md px-3 py-2" data-testid="text-error">{errMsg(e)}</p>;
}

export function Skel({ h = "h-40" }: { h?: string }) {
  return <div className={`${h} bg-muted animate-pulse rounded-md`} />;
}
