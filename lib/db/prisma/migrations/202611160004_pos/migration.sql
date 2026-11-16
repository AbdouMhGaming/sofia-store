-- AlterTable
ALTER TABLE `stock_movements` ADD COLUMN `refundItemId` INTEGER NULL,
    ADD COLUMN `saleItemId` INTEGER NULL;

-- CreateTable
CREATE TABLE `cash_registers` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(40) NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `currentSessionId` INTEGER NULL,

    UNIQUE INDEX `cash_registers_code_key`(`code`),
    UNIQUE INDEX `cash_registers_currentSessionId_key`(`currentSessionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `register_sessions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `registerId` INTEGER NOT NULL,
    `openedById` INTEGER NOT NULL,
    `closedById` INTEGER NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    `openingMinor` INTEGER NOT NULL,
    `openedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `closedAt` DATETIME(3) NULL,
    `expectedMinor` INTEGER NULL,
    `countedMinor` INTEGER NULL,
    `varianceMinor` INTEGER NULL,
    `closeReason` VARCHAR(500) NULL,
    `openRequestId` VARCHAR(100) NOT NULL,
    `openRequestHash` VARCHAR(64) NOT NULL,
    `closeRequestId` VARCHAR(100) NULL,
    `closeRequestHash` VARCHAR(64) NULL,

    UNIQUE INDEX `register_sessions_openRequestId_key`(`openRequestId`),
    UNIQUE INDEX `register_sessions_closeRequestId_key`(`closeRequestId`),
    INDEX `register_sessions_openedById_openedAt_idx`(`openedById`, `openedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sales` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `number` VARCHAR(80) NOT NULL,
    `requestId` VARCHAR(100) NOT NULL,
    `requestHash` VARCHAR(64) NOT NULL,
    `registerSessionId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `status` VARCHAR(30) NOT NULL DEFAULT 'COMPLETED',
    `subtotalMinor` INTEGER NOT NULL,
    `discountMinor` INTEGER NOT NULL,
    `discountReason` VARCHAR(500) NOT NULL DEFAULT '',
    `totalMinor` INTEGER NOT NULL,
    `storeName` VARCHAR(150) NOT NULL,
    `storeAddress` VARCHAR(500) NOT NULL DEFAULT '',
    `storePhone` VARCHAR(60) NOT NULL DEFAULT '',
    `receiptFooter` VARCHAR(500) NOT NULL DEFAULT '',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `sales_number_key`(`number`),
    UNIQUE INDEX `sales_requestId_key`(`requestId`),
    INDEX `sales_userId_id_idx`(`userId`, `id`),
    INDEX `sales_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sale_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `saleId` INTEGER NOT NULL,
    `variantId` INTEGER NOT NULL,
    `productName` VARCHAR(150) NOT NULL,
    `nameAr` VARCHAR(150) NOT NULL,
    `sku` VARCHAR(80) NOT NULL,
    `barcode` VARCHAR(80) NOT NULL,
    `size` VARCHAR(30) NOT NULL,
    `color` VARCHAR(60) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `unitPriceMinor` INTEGER NOT NULL,
    `unitCostMinor` INTEGER NOT NULL,
    `discountMinor` INTEGER NOT NULL,
    `lineTotalMinor` INTEGER NOT NULL,

    UNIQUE INDEX `sale_items_saleId_variantId_key`(`saleId`, `variantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `saleId` INTEGER NOT NULL,
    `method` VARCHAR(20) NOT NULL DEFAULT 'CASH',
    `amountMinor` INTEGER NOT NULL,
    `tenderedMinor` INTEGER NOT NULL,
    `changeMinor` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `payments_saleId_key`(`saleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refunds` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `number` VARCHAR(80) NOT NULL,
    `requestId` VARCHAR(100) NOT NULL,
    `requestHash` VARCHAR(64) NOT NULL,
    `saleId` INTEGER NOT NULL,
    `registerSessionId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `kind` VARCHAR(20) NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `amountMinor` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `refunds_number_key`(`number`),
    UNIQUE INDEX `refunds_requestId_key`(`requestId`),
    INDEX `refunds_saleId_id_idx`(`saleId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refund_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `refundId` INTEGER NOT NULL,
    `saleItemId` INTEGER NOT NULL,
    `quantity` INTEGER NOT NULL,
    `restock` BOOLEAN NOT NULL,
    `amountMinor` INTEGER NOT NULL,

    INDEX `refund_items_saleItemId_idx`(`saleItemId`),
    UNIQUE INDEX `refund_items_refundId_saleItemId_key`(`refundId`, `saleItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `stock_movements_saleItemId_key` ON `stock_movements`(`saleItemId`);

-- CreateIndex
CREATE UNIQUE INDEX `stock_movements_refundItemId_key` ON `stock_movements`(`refundItemId`);

-- AddForeignKey
ALTER TABLE `stock_movements` ADD CONSTRAINT `stock_movements_saleItemId_fkey` FOREIGN KEY (`saleItemId`) REFERENCES `sale_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_movements` ADD CONSTRAINT `stock_movements_refundItemId_fkey` FOREIGN KEY (`refundItemId`) REFERENCES `refund_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cash_registers` ADD CONSTRAINT `cash_registers_currentSessionId_fkey` FOREIGN KEY (`currentSessionId`) REFERENCES `register_sessions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `register_sessions` ADD CONSTRAINT `register_sessions_registerId_fkey` FOREIGN KEY (`registerId`) REFERENCES `cash_registers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `register_sessions` ADD CONSTRAINT `register_sessions_openedById_fkey` FOREIGN KEY (`openedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `register_sessions` ADD CONSTRAINT `register_sessions_closedById_fkey` FOREIGN KEY (`closedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales` ADD CONSTRAINT `sales_registerSessionId_fkey` FOREIGN KEY (`registerSessionId`) REFERENCES `register_sessions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales` ADD CONSTRAINT `sales_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale_items` ADD CONSTRAINT `sale_items_saleId_fkey` FOREIGN KEY (`saleId`) REFERENCES `sales`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sale_items` ADD CONSTRAINT `sale_items_variantId_fkey` FOREIGN KEY (`variantId`) REFERENCES `product_variants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_saleId_fkey` FOREIGN KEY (`saleId`) REFERENCES `sales`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refunds` ADD CONSTRAINT `refunds_saleId_fkey` FOREIGN KEY (`saleId`) REFERENCES `sales`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refunds` ADD CONSTRAINT `refunds_registerSessionId_fkey` FOREIGN KEY (`registerSessionId`) REFERENCES `register_sessions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refunds` ADD CONSTRAINT `refunds_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refund_items` ADD CONSTRAINT `refund_items_refundId_fkey` FOREIGN KEY (`refundId`) REFERENCES `refunds`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refund_items` ADD CONSTRAINT `refund_items_saleItemId_fkey` FOREIGN KEY (`saleItemId`) REFERENCES `sale_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Financial invariants supplement application validation. Existing tables/data
-- are preserved; the only seed is physical-drawer configuration, not a cash balance.
ALTER TABLE `sales` ADD CONSTRAINT `sales_totals_check` CHECK (
  `subtotalMinor` >= 0 AND `discountMinor` >= 0 AND `discountMinor` <= `subtotalMinor`
  AND `totalMinor` = `subtotalMinor` - `discountMinor`
);
ALTER TABLE `sale_items` ADD CONSTRAINT `sale_items_totals_check` CHECK (
  `quantity` > 0 AND `unitPriceMinor` > 0 AND `unitCostMinor` >= 0
  AND `discountMinor` >= 0 AND `lineTotalMinor` >= 0
  AND `lineTotalMinor` = `quantity` * `unitPriceMinor` - `discountMinor`
);
ALTER TABLE `payments` ADD CONSTRAINT `payments_cash_check` CHECK (
  `amountMinor` >= 0 AND `tenderedMinor` >= `amountMinor`
  AND `changeMinor` = `tenderedMinor` - `amountMinor`
);
ALTER TABLE `refunds` ADD CONSTRAINT `refunds_amount_check` CHECK (`amountMinor` >= 0);
ALTER TABLE `refund_items` ADD CONSTRAINT `refund_items_quantity_check` CHECK (`quantity` > 0 AND `amountMinor` >= 0);
ALTER TABLE `register_sessions` ADD CONSTRAINT `register_sessions_cash_check` CHECK (
  `openingMinor` >= 0 AND (`countedMinor` IS NULL OR `countedMinor` >= 0)
  AND (`expectedMinor` IS NULL OR `expectedMinor` >= 0)
);
ALTER TABLE `register_sessions` ADD CONSTRAINT `register_sessions_status_check` CHECK (
  (`status` = 'OPEN' AND `closedAt` IS NULL AND `countedMinor` IS NULL)
  OR (`status` = 'CLOSED' AND `closedAt` IS NOT NULL AND `countedMinor` IS NOT NULL
      AND `expectedMinor` IS NOT NULL AND `varianceMinor` = `countedMinor` - `expectedMinor`)
);
-- Hostinger's MySQL-compatible engine disallows CHECK expressions on columns
-- with cascading-update foreign keys. Their actor/source invariants are checked
-- in the transaction service; all foreign keys themselves remain enforced.
INSERT INTO `cash_registers` (`code`, `name`) VALUES ('MAIN', 'Caisse principale');

