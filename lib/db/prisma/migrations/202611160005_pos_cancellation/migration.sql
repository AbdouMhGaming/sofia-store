-- CreateTable
CREATE TABLE `pos_cancellations` (
    `kind` VARCHAR(20) NOT NULL,
    `requestId` VARCHAR(100) NOT NULL,
    `userId` INTEGER NOT NULL,
    `registerId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`kind`, `requestId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `pos_cancellations` ADD CONSTRAINT `pos_cancellations_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pos_cancellations` ADD CONSTRAINT `pos_cancellations_registerId_fkey` FOREIGN KEY (`registerId`) REFERENCES `cash_registers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

