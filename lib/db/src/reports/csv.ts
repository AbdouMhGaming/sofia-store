import type { RetailReport } from "@workspace/api-zod";

/** Only text is escaped as spreadsheet text; negative numeric amounts stay numbers. */
export function reportCsvCell(value: string | number): string {
  let text = String(value);
  if (typeof value === "string" && /^[\s\uFEFF]*[=+\-@]/u.test(text)) text = "'" + text;
  return `"${text.replace(/"/g, '""')}"`;
}
export function retailReportCsv(r: RetailReport) {
  const rows: (string | number)[][] = [["section", "groupe", "mesure", "valeur", "unite"]];
  const meta = (key: string, value: string) => rows.push(["parametres", "", key, value, "texte"]);
  meta("debut_inclus", r.from); meta("fin_incluse", r.to); meta("regroupement", r.groupBy); meta("canal", r.channel);
  meta("fuseau", r.timezone); meta("genere_le", new Date(r.generatedAt).toISOString());
  meta("empreinte_resultat", r.fingerprint);
  for (const d of r.definitions) rows.push(["definitions", d.key, d.label, d.explanation, "texte"]);
  for (const warning of r.warnings) rows.push(["avertissements", "", "", warning, "texte"]);
  const numbers = (section: string, label: string, prefix: string, values: object) => {
    for (const [key, value] of Object.entries(values)) rows.push([section, label, `${prefix}${key}`, value as number, key.endsWith("Minor") ? "centimes_DZD" : "unites"]);
  };
  for (const [section, buckets] of [["total", [r.summary]], ["periodes", r.periods], ["canaux", r.channels]] as const) {
    for (const b of buckets) {
      rows.push([section, b.label, "salesCount", b.salesCount, "transactions"]);
      numbers(section, b.label, "activite.", b.activity); numbers(section, b.label, "tresorerie.", b.money);
      rows.push([section, b.label, "estimatedMarginMinor", b.estimatedMarginMinor, "centimes_DZD"]);
    }
  }
  for (const [section, groups] of [["produits_actuels", r.products], ["categories_actuelles", r.categories]] as const)
    for (const g of groups) numbers(section, `${g.key} — ${g.label}`, "activite.", g.activity);
  rows.push(["solde_transporteur", "", "grossMinor", r.outstanding.grossMinor, "centimes_DZD"],
    ["solde_transporteur", "", "count", r.outstanding.count, "commandes"],
    ["solde_transporteur", "", "asOf", new Date(r.outstanding.asOf).toISOString(), "texte"]);
  return "\uFEFF" + rows.map(row => row.map(reportCsvCell).join(";")).join("\r\n") + "\r\n";
}
