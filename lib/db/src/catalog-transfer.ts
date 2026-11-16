import { parse } from "csv-parse/sync";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";

export const catalogHeaders = ["productSlug", "nameFr", "nameAr", "descriptionFr", "descriptionAr", "categorySlug", "imagePath", "sku", "barcode", "size", "color", "priceMinor", "costMinor"] as const;
type Column = typeof catalogHeaders[number];
type CsvRow = Record<Column, string>;
type ImportResult = { valid: boolean; committed: boolean; products: number; variants: number; errors: string[]; warnings: string[] };
export function csvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  // Quoting alone does not prevent spreadsheet formulas.
  if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return `"${text.replace(/"/g, '""')}"`;
}
export function parseCatalogCsv(csv: string): { rows: CsvRow[]; errors: string[] } {
  if (csv.length > 200000) return { rows: [], errors: ["Le fichier dépasse 200 000 caractères."] };
  let rows: CsvRow[];
  try {
    rows = parse(csv, {
      bom: true, skip_empty_lines: true, trim: true, max_record_size: 20000,
      columns: (headers: string[]) => {
        if (headers.length !== catalogHeaders.length || headers.some((h, i) => h !== catalogHeaders[i])) throw new Error("HEADERS");
        return headers;
      },
    }) as CsvRow[];
  } catch { return { rows: [], errors: ["CSV invalide : utilisez le modèle fourni, les 13 colonnes dans l'ordre, et des virgules comme séparateur."] }; }
  if (!rows.length || rows.length > 100) return { rows: [], errors: ["Un import doit contenir entre 1 et 100 lignes de variantes."] };
  const errors: string[] = [], skus = new Set<string>(), barcodes = new Set<string>(), combinations = new Set<string>(), products = new Map<string, string>();
  for (const [index, row] of rows.entries()) {
    const label = `Enregistrement ${index + 1}`;
    for (const field of ["productSlug", "nameFr", "nameAr", "categorySlug", "sku", "barcode", "size", "color"] as const) {
      if (!row[field]?.trim()) errors.push(`${label} : ${field} obligatoire.`);
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.productSlug) || row.productSlug.length > 190) errors.push(`${label} : productSlug invalide.`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.categorySlug)) errors.push(`${label} : categorySlug invalide.`);
    for (const [field, max] of [["nameFr", 150], ["nameAr", 150], ["descriptionFr", 5000], ["descriptionAr", 5000], ["sku", 80], ["barcode", 80], ["size", 30], ["color", 60]] as const) {
      if (row[field].length > max) errors.push(`${label} : ${field} dépasse ${max} caractères.`);
    }
    if (!/^[1-9]\d*$/.test(row.priceMinor) || Number(row.priceMinor) > 100000000) errors.push(`${label} : priceMinor doit être un entier positif en centimes, au plus 100000000.`);
    if (!/^(0|[1-9]\d*)$/.test(row.costMinor) || Number(row.costMinor) > 100000000) errors.push(`${label} : costMinor doit être un entier en centimes, entre 0 et 100000000.`);
    if (row.imagePath && !/^\/products\/dress-[1-6]\.jpeg$/.test(row.imagePath) && !/^\/api\/media\/[a-f0-9-]{36}\/image$/.test(row.imagePath)) errors.push(`${label} : imagePath doit désigner une photo fournie ou une image validée de la médiathèque.`);
    const combination = `${row.productSlug}\0${row.size.toLowerCase()}\0${row.color.toLowerCase()}`;
    if (skus.has(row.sku.toLowerCase())) errors.push(`${label} : SKU en double dans le fichier.`);
    if (barcodes.has(row.barcode.toLowerCase())) errors.push(`${label} : code-barres en double dans le fichier.`);
    if (combinations.has(combination)) errors.push(`${label} : combinaison produit/taille/couleur en double.`);
    skus.add(row.sku.toLowerCase()); barcodes.add(row.barcode.toLowerCase()); combinations.add(combination);
    const meta = JSON.stringify([row.nameFr, row.nameAr, row.descriptionFr, row.descriptionAr, row.categorySlug, row.imagePath]);
    if (products.has(row.productSlug) && products.get(row.productSlug) !== meta) errors.push(`${label} : les données du même produit doivent être identiques sur chaque ligne.`);
    products.set(row.productSlug, meta);
  }
  return { rows, errors: errors.slice(0, 50) };
}

export async function transferCatalog(tx: Prisma.TransactionClient, input: { csv: string; dryRun: boolean; requestId: string }, userId: number): Promise<ImportResult> {
  const requestHash = createHash("sha256").update(`${userId}\0${input.csv}`).digest("hex");
  const previous = await tx.importBatch.findUnique({ where: { requestId: input.requestId } });
  if (previous) {
    if (previous.requestHash !== requestHash || previous.userId !== userId) throw Object.assign(new Error("Cette référence d'import a déjà été utilisée avec un autre fichier."), { status: 409 });
    return { valid: true, committed: true, products: previous.products, variants: previous.variants, errors: [], warnings: ["Cet import a déjà été enregistré. Aucun doublon créé."] };
  }
  const parsed = parseCatalogCsv(input.csv);
  const result: ImportResult = {
    valid: false, committed: false, products: new Set(parsed.rows.map(r => r.productSlug)).size, variants: parsed.rows.length,
    errors: [...parsed.errors], warnings: ["Nouveaux produits uniquement, créés en aperçu. Aucun prix, produit ou stock existant n'est modifié.", "Les variantes commencent avec un stock nul. Enregistrez les réceptions séparément."],
  };
  if (result.errors.length) return result;
  const rows = parsed.rows;
  const slugs = [...new Set(rows.map(r => r.productSlug))], categorySlugs = [...new Set(rows.map(r => r.categorySlug))];
  const [categories, existingProducts, conflicts] = await Promise.all([
    tx.category.findMany({ where: { slug: { in: categorySlugs } } }),
    tx.product.findMany({ where: { slug: { in: slugs } }, select: { slug: true } }),
    tx.productVariant.findMany({ where: { OR: [{ sku: { in: rows.map(r => r.sku) } }, { barcode: { in: rows.map(r => r.barcode) } }] }, select: { sku: true, barcode: true } }),
  ]);
  for (const slug of categorySlugs) if (!categories.some(c => c.slug === slug)) result.errors.push(`Catégorie introuvable : ${slug}. Créez-la avant l'import.`);
  for (const p of existingProducts) result.errors.push(`Le produit ${p.slug} existe déjà. Aucun écrasement autorisé.`);
  for (const c of conflicts) result.errors.push(`SKU ou code-barres déjà attribué : ${c.sku}.`);
  const mediaIds = [...new Set(rows.filter(r => r.imagePath.startsWith("/api/media/")).map(r => r.imagePath.split("/")[3]!))].sort();
  for (const id of mediaIds) {
    const assets = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM media_assets WHERE id = ${id} FOR UPDATE`;
    if (assets[0]?.status !== "READY") result.errors.push(`Image indisponible : ${id}.`);
  }
  result.errors = result.errors.slice(0, 50);
  if (result.errors.length) return result;
  result.valid = true;
  if (input.dryRun) return result;
  await tx.importBatch.create({ data: { requestId: input.requestId, requestHash, userId, products: result.products, variants: result.variants } });
  const productRows = [...new Map(rows.map(r => [r.productSlug, r])).values()];
  await tx.product.createMany({ data: productRows.map(r => ({
    slug: r.productSlug, nameFr: r.nameFr, nameAr: r.nameAr, descriptionFr: r.descriptionFr, descriptionAr: r.descriptionAr,
    categoryId: categories.find(c => c.slug === r.categorySlug)!.id, status: "PREVIEW",
  })) });
  const products = await tx.product.findMany({ where: { slug: { in: slugs } } });
  const imageRows = productRows.filter(r => r.imagePath).map(r => ({
    productId: products.find(p => p.slug === r.productSlug)!.id, path: r.imagePath, position: 0,
    mediaId: r.imagePath.startsWith("/api/media/") ? r.imagePath.split("/")[3]! : null,
  }));
  if (imageRows.length) await tx.productImage.createMany({ data: imageRows });
  await tx.size.createMany({ data: [...new Set(rows.map(r => r.size))].map(name => ({ name })), skipDuplicates: true });
  await tx.color.createMany({ data: [...new Set(rows.map(r => r.color))].map(name => ({ name })), skipDuplicates: true });
  const [sizes, colors, location] = await Promise.all([
    tx.size.findMany({ where: { name: { in: rows.map(r => r.size) } } }),
    tx.color.findMany({ where: { name: { in: rows.map(r => r.color) } } }),
    tx.location.findUniqueOrThrow({ where: { code: "STORE" } }),
  ]);
  // MySQL's collation is case-insensitive. Match names consistently with uniqueness.
  const folded = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  await tx.productVariant.createMany({ data: rows.map(r => ({
    productId: products.find(p => p.slug === r.productSlug)!.id,
    sizeId: sizes.find(s => folded(s.name) === folded(r.size))!.id,
    colorId: colors.find(c => folded(c.name) === folded(r.color))!.id,
    sku: r.sku, barcode: r.barcode, priceMinor: Number(r.priceMinor), costMinor: Number(r.costMinor),
  })) });
  const variants = await tx.productVariant.findMany({ where: { sku: { in: rows.map(r => r.sku) } }, select: { id: true } });
  await tx.inventory.createMany({ data: variants.map(v => ({ variantId: v.id, locationId: location.id, onHand: 0, reserved: 0 })) });
  await tx.auditLog.create({ data: { userId, action: "CATALOG_IMPORTED", detail: `Import CSV : ${result.products} produits, ${result.variants} variantes. Stock initial nul.` } });
  result.committed = true;
  return result;
}
