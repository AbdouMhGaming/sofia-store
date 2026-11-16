import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import storeRouter from "./store";
import catalogAdminRouter from "./catalog-admin";
import inventoryRouter from "./inventory";
import { requireStaff } from "../lib/security";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(storeRouter);
router.use("/admin", requireStaff);
router.use(catalogAdminRouter);
router.use(inventoryRouter);

export default router;
