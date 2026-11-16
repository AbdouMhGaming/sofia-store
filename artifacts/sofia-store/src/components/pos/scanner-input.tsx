import { useEffect, useRef, useState } from "react";
import { ScanBarcode } from "lucide-react";
import { lookupPosBarcode, type PosVariant } from "@workspace/api-client-react";
import { errMsg } from "@/lib/util";
import { statusOf } from "@/lib/pos";

/** Dedicated keyboard-wedge field. Only this input listens; no global key capture. */
export function ScannerInput({ disabled, onFound, focusSignal }: { disabled: boolean; onFound: (v: PosVariant) => void; focusSignal: number }) {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(0);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; n: number } | null>(null);
  const onFoundRef = useRef(onFound);
  onFoundRef.current = onFound;

  useEffect(() => {
    // Refocus only when nothing else (dialog, form field) currently owns focus.
    const a = document.activeElement;
    if (!disabled && (!a || a === document.body || a === ref.current)) ref.current?.focus();
  }, [focusSignal, disabled]);

  const submit = async () => {
    const code = value.replace(/[\r\n]+$/, "");
    setValue("");
    if (!code) return;
    if (code.length > 80) return setMsg({ ok: false, text: "Code trop long (80 caractères max).", n: Date.now() });
    setBusy((b) => b + 1);
    try {
      const v = await lookupPosBarcode({ barcode: code });
      onFoundRef.current(v);
      setMsg({ ok: true, text: `${v.productName} · ${v.size} / ${v.color}`, n: Date.now() });
    } catch (e) {
      setMsg({ ok: false, text: statusOf(e) === 404 ? `Aucun article pour le code « ${code} ».` : errMsg(e), n: Date.now() });
    } finally {
      setBusy((b) => b - 1);
      ref.current?.focus();
    }
  };

  return (
    <div>
      <label className="relative block">
        <ScanBarcode className={`absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 ${busy ? "text-primary animate-pulse" : "text-muted-foreground"}`} strokeWidth={1.5} />
        <input ref={ref} autoFocus disabled={disabled} value={value} autoComplete="off" spellCheck={false}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
          placeholder={disabled ? "Saisie verrouillée" : "Scanner un code-barres puis Entrée"}
          className="w-full pl-12 pr-4 py-3.5 rounded-md bg-card border-2 border-[#282326]/15 font-mono text-base tracking-wider outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 transition disabled:opacity-50"
          data-testid="input-scanner" />
      </label>
      <div className="h-6 mt-1.5 text-xs">
        {msg && <p key={msg.n} className={`rise ${msg.ok ? "text-emerald-700" : "text-destructive"}`} data-testid="status-scan">{msg.ok ? "Ajouté : " : ""}{msg.text}</p>}
      </div>
    </div>
  );
}
