import { useEffect, useState } from "react";

export const PRODUCT_IMAGES = [1, 2, 3, 4, 5, 6].map((n) => `/products/dress-${n}.jpeg`);

export function asset(path: string) {
  if (!path) return path;
  if (/^https?:/.test(path)) return path;
  return import.meta.env.BASE_URL.replace(/\/$/, "") + path;
}

export function telHref(phone: string) {
  return "tel:" + phone.replace(/\s+/g, "");
}

/** Parses a DA string into integer centimes using decimal string math (no float multiplication). */
export function daToMinor(input: string): number | null {
  const s = input.trim().replace(/\s/g, "").replace(",", ".");
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const whole = parseInt(m[1], 10);
  const frac = parseInt((m[2] ?? "").padEnd(2, "0") || "0", 10);
  return whole * 100 + frac;
}

export function formatDA(minor: number) {
  const whole = Math.trunc(minor / 100);
  const frac = Math.abs(minor % 100);
  return `${whole.toLocaleString("fr-FR")}${frac ? "," + String(frac).padStart(2, "0") : ""} DA`;
}

export function errMsg(e: unknown): string {
  if (!e) return "";
  const d = (e as { data?: unknown }).data;
  if (d && typeof d === "object") {
    const o = d as Record<string, unknown>;
    if (typeof o.message === "string") return o.message;
    if (typeof o.error === "string") return o.error;
  }
  return e instanceof Error ? e.message : String(e);
}

const FAV_KEY = "sofia-favorites";
export function useFavorites() {
  const [ids, setIds] = useState<number[]>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(FAV_KEY) || "[]");
      return Array.isArray(v) ? v.filter((x) => typeof x === "number") : [];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    const h = () => {
      try { setIds(JSON.parse(localStorage.getItem(FAV_KEY) || "[]")); } catch { /* ignore */ }
    };
    window.addEventListener("sofia-fav", h);
    return () => window.removeEventListener("sofia-fav", h);
  }, []);
  const toggle = (id: number) => {
    const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
    localStorage.setItem(FAV_KEY, JSON.stringify(next));
    setIds(next);
    window.dispatchEvent(new Event("sofia-fav"));
  };
  return { ids, toggle, has: (id: number) => ids.includes(id) };
}
