import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import storeRouter from "./store";
import catalogAdminRouter from "./catalog-admin";
import inventoryRouter from "./inventory";
import { requireStaff } from "../lib/security";
import catalogToolsRouter from "./catalog-tools";
import catalogTransferRouter from "./catalog-transfer";
import mediaRouter from "./media";
import posRouter from "./pos";
import checkoutRouter from "./checkout";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(storeRouter);
router.use("/admin", requireStaff);
router.use(catalogAdminRouter);
router.use(inventoryRouter);
router.use(catalogToolsRouter);
router.use(catalogTransferRouter);
router.use(mediaRouter);
router.use("/pos", posRouter);
router.use(checkoutRouter);

export default router;
