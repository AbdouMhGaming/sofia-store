CREATE TABLE `web_orders` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `reference` VARCHAR(80) NOT NULL,
  `requestId` VARCHAR(36) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  `fulfillment` VARCHAR(20) NOT NULL,
  `customerName` VARCHAR(150) NOT NULL,
  `customerPhone` VARCHAR(25) NOT NULL,
  `commune` VARCHAR(150) NOT NULL,
  `address` VARCHAR(500) NOT NULL,
  `notes` VARCHAR(1000) NOT NULL,
  `subtotalMinor` INTEGER NOT NULL,
  `feeMinor` INTEGER NOT NULL,
  `totalMinor` INTEGER NOT NULL,
  `snapshot` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `expiresAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `web_orders_reference_key` (`reference`),
  UNIQUE INDEX `web_orders_requestId_key` (`requestId`),
  INDEX `web_orders_status_expiresAt_idx` (`status`, `expiresAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `web_orders_totals_check` CHECK (`subtotalMinor` >= 0 AND `feeMinor` >= 0 AND `totalMinor` = `subtotalMinor` + `feeMinor`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `web_order_items` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `orderId` INTEGER NOT NULL,
  `variantId` INTEGER NOT NULL,
  `quantity` INTEGER NOT NULL,
  `unitPriceMinor` INTEGER NOT NULL,
  `unitCostMinor` INTEGER NOT NULL,
  `lineTotalMinor` INTEGER NOT NULL,
  UNIQUE INDEX `web_order_items_orderId_variantId_key` (`orderId`, `variantId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `web_order_items_totals_check` CHECK (`quantity` > 0 AND `unitPriceMinor` > 0 AND `unitCostMinor` >= 0 AND `lineTotalMinor` = `quantity` * `unitPriceMinor`),
  CONSTRAINT `web_order_items_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `web_orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `web_order_items_variantId_fkey` FOREIGN KEY (`variantId`) REFERENCES `product_variants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `web_order_events` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `orderId` INTEGER NOT NULL,
  `userId` INTEGER NULL,
  `kind` VARCHAR(30) NOT NULL,
  `reason` VARCHAR(500) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  CONSTRAINT `web_order_events_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `web_orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `web_order_events_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `checkout_attempts` (
  `requestId` VARCHAR(36) NOT NULL,
  `tokenHash` VARCHAR(64) NOT NULL,
  `requestHash` VARCHAR(64) NULL,
  `state` VARCHAR(20) NOT NULL,
  `orderId` INTEGER NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `checkout_attempts_orderId_key` (`orderId`),
  PRIMARY KEY (`requestId`),
  CONSTRAINT `checkout_attempts_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `web_orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- Serialization point for configuration, request tombstones and reservation lifecycle.
INSERT INTO `store_settings` (`key`, `value`) VALUES ('checkout.lock', '1');
