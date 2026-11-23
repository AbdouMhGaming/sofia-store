ALTER TABLE `web_orders`
 ADD COLUMN `collector` VARCHAR(20) NULL,
 ADD COLUMN `carrierName` VARCHAR(150) NOT NULL DEFAULT '',
 ADD COLUMN `trackingNumber` VARCHAR(150) NOT NULL DEFAULT '',
 ADD COLUMN `courierCollected` BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE `web_order_payments` (
 `id` INTEGER NOT NULL AUTO_INCREMENT,
 `orderId` INTEGER NOT NULL,
 `kind` VARCHAR(20) NOT NULL,
 `method` VARCHAR(20) NOT NULL,
 `amountMinor` INTEGER NOT NULL,
 `feeMinor` INTEGER NOT NULL DEFAULT 0,
 `feeRefundMinor` INTEGER NOT NULL DEFAULT 0,
 `tenderedMinor` INTEGER NULL,
 `changeMinor` INTEGER NOT NULL DEFAULT 0,
 `reference` VARCHAR(150) NOT NULL,
 `reason` VARCHAR(500) NOT NULL,
 `registerSessionId` INTEGER NULL,
 `userId` INTEGER NOT NULL,
 `receiptSettings` JSON NOT NULL,
 `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY (`id`),
 UNIQUE INDEX `web_order_payments_orderId_kind_key` (`orderId`, `kind`),
 INDEX `web_order_payments_registerSessionId_idx` (`registerSessionId`),
 CONSTRAINT `web_order_payments_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `web_orders` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT `web_order_payments_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT `web_order_payments_registerSessionId_fkey` FOREIGN KEY (`registerSessionId`) REFERENCES `register_sessions` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT `web_payment_money_valid` CHECK (`amountMinor` >= 0 AND `feeMinor` >= 0 AND `feeRefundMinor` >= 0 AND `changeMinor` >= 0 AND (`tenderedMinor` IS NULL OR `tenderedMinor` >= 0))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `web_order_commands` (
 `requestId` VARCHAR(36) NOT NULL,
 `orderId` INTEGER NOT NULL,
 `userId` INTEGER NOT NULL,
 `requestHash` VARCHAR(64) NULL,
 `state` VARCHAR(20) NOT NULL,
 `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY (`requestId`),
 CONSTRAINT `web_order_commands_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `web_orders` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT `web_order_commands_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
