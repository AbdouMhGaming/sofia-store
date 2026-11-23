CREATE TABLE `account_guards` (
  `userId` INTEGER NOT NULL,
  PRIMARY KEY (`userId`),
  CONSTRAINT `account_guards_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `account_guards` (`userId`) SELECT `id` FROM `users`;
