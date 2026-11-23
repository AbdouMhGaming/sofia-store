import { Prisma } from "@prisma/client";
import type { GetRetailReportParams } from "@workspace/api-zod";
import { db } from "../index";
import { reportFail, reportOptions, reportOwner } from "./primitives";
import { loadRetailReportSource } from "./load";
import { aggregateRetailReport } from "./aggregate";

export async function readRetailReport(input: GetRetailReportParams, actor: { role: string }) {
  reportOwner(actor);
  const now = new Date(), options = reportOptions(input, now);
  // A read-only consistent snapshot is appropriate here: no locks, no re-reads
  // after waiting for a financial lock. Financial writes remain READ COMMITTED.
  const report = await db.$transaction(async tx => aggregateRetailReport(await loadRetailReportSource(tx, options), options, now),
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000, maxWait: 5000 });
  if (input.expectedFingerprint && input.expectedFingerprint !== report.fingerprint)
    reportFail("Les chiffres ont changé. Actualisez le rapport avant de relancer l'export.", 409);
  return report;
}
export { reportOptions, reportOwner } from "./primitives";
export { aggregateRetailReport } from "./aggregate";
export { loadRetailReportSource } from "./load";
export { retailReportCsv, reportCsvCell } from "./csv";
