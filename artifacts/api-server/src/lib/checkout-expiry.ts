import { expireCheckoutOrders, posTransaction } from "@workspace/db";
import { logger } from "./logger";

export function startCheckoutExpiry() {
  let running = false;
  const sweep = async () => {
    if (running) return;
    running = true;
    try {
      // Bounded catch-up. Multiple Node instances serialize through the DB gate.
      for (let batch = 0; batch < 5; batch++) if (await posTransaction(expireCheckoutOrders) < 20) break;
    } catch {
      logger.error({ code: "CHECKOUT_EXPIRY_FAILED" }, "Pending order expiry could not be confirmed");
    } finally { running = false; }
  };
  const timer = setInterval(() => { void sweep(); }, 30000);
  timer.unref();
  void sweep();
  return () => clearInterval(timer);
}
