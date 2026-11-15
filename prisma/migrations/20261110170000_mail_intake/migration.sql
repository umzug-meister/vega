ALTER TABLE `order`
  ADD COLUMN `sourceMailUid` INTEGER NULL,
  ADD COLUMN `sourceMessageId` VARCHAR(998) NULL;

ALTER TABLE `emailOutbox`
  ADD COLUMN `replyToMailUid` INTEGER NULL;
