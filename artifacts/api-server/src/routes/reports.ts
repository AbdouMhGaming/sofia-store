import { Router, type IRouter } from "express";
import { readRetailReport, reportOwner, retailReportCsv } from "@workspace/db";
import { GetRetailReportQueryParams, GetRetailReportResponse, ExportRetailReportQueryParams, ExportRetailReportResponse } from "@workspace/api-zod";
import type { Identity } from "../lib/security";

const router: IRouter = Router();
router.get("/admin/reports", async (req, res): Promise<void> => {
  const who = res.locals.identity as Identity;
  reportOwner(who.user);
  const params = GetRetailReportQueryParams.safeParse(req.query);
  if (!params.success) { res.status(400).json({ error: "Filtres de rapport invalides." }); return; }
  res.set("Cache-Control", "private, no-store").vary("Cookie");
  res.json(GetRetailReportResponse.parse(await readRetailReport(params.data, who.user)));
});
router.get("/admin/reports/export", async (req, res): Promise<void> => {
  const who = res.locals.identity as Identity;
  reportOwner(who.user);
  const params = ExportRetailReportQueryParams.safeParse(req.query);
  if (!params.success) { res.status(400).json({ error: "Filtres de rapport invalides." }); return; }
  const report = GetRetailReportResponse.parse(await readRetailReport(params.data, who.user));
  res.set("Cache-Control", "private, no-store").vary("Cookie");
  res.attachment(`sofia-rapport-${report.from}-${report.to}-${report.channel.toLowerCase()}.csv`);
  res.type("text/csv; charset=utf-8").send(ExportRetailReportResponse.parse(retailReportCsv(report)));
});
export default router;
