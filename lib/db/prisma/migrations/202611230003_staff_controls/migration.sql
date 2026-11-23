ALTER TABLE `users` ADD COLUMN `version` INTEGER NOT NULL DEFAULT 1;

CREATE TABLE `staff_commands` (
  `requestId` VARCHAR(36) NOT NULL,
  `actorId` INTEGER NOT NULL,
  `requestHash` VARCHAR(64) NOT NULL,
  `kind` VARCHAR(16) NOT NULL,
  `state` VARCHAR(16) NOT NULL,
  `resultUserId` INTEGER NULL,
  `resultVersion` INTEGER NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`requestId`),
  INDEX `staff_commands_actorId_createdAt_idx` (`actorId`, `createdAt`),
  CONSTRAINT `staff_commands_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `staff_commands_resultUserId_fkey` FOREIGN KEY (`resultUserId`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `staff_commands_kind_check` CHECK (`kind` IN ('CREATE', 'UPDATE', 'RESET')),
  CONSTRAINT `staff_commands_state_check` CHECK (`state` IN ('COMMITTED', 'CANCELLED'))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
