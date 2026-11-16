import express, { type Express, type ErrorRequestHandler } from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { requireCsrf } from "./lib/security";

const app: Express = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());
app.use("/api", (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
app.use("/api", requireCsrf);

app.use("/api", router);
const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const code = typeof err?.code === "string" ? err.code : undefined;
  req.log.error({ code: code || "REQUEST_ERROR" }, "Request failed");
  if (err?.status && Number.isInteger(err.status) && err.status >= 400 && err.status < 500 && !code) {
    res.status(err.status).json({ error: err.type === "entity.parse.failed" ? "JSON invalide." : err.message });
    return;
  }
  if (code === "P2002") { res.status(409).json({ error: "Cette référence existe déjà. Vérifiez le SKU, le code-barres ou la variante." }); return; }
  if (code === "P2025" || code === "P2003") { res.status(400).json({ error: "Référence introuvable ou utilisée par un autre enregistrement." }); return; }
  if (code === "P2034") { res.status(409).json({ error: "Une opération concurrente a eu lieu. Réessayez avec la même référence." }); return; }
  res.status(500).json({ error: "Opération indisponible. Aucune réussite ne peut être confirmée. Réessayez ou contactez le responsable." });
};
app.use(errorHandler);

export default app;
